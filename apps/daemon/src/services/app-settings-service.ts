import type {
  OutputDetail,
  ReasoningSummary,
} from "@cwpi/agent-runtime/model-response-preferences";
import type { BusySubmitBehavior } from "@cwpi/agent-runtime/user-input";
import {
  type ApprovalPolicyValue,
  readSandboxPolicy,
  SandboxProfile,
  type SandboxProfileValue,
  writeSandboxPolicy,
} from "@cwpi/policy";
import { isWindowsShellEnabled, prepareWindowsShellSandbox } from "@cwpi/sandbox";
import type { UpdateAppSettingsDto } from "../dto/app-settings-dto.js";
import type { FileOpenMode } from "../schemas/file-open.js";
import type {
  AppSettingRepository,
  ComputerUseAllowedApp,
  DefaultModelSetting,
  FileOpenApplicationSetting,
} from "../storage/database.js";

export interface AppSettings {
  approvalPolicy: ApprovalPolicyValue;
  busySubmitBehavior: BusySubmitBehavior;
  computerUseAllowedApps: ComputerUseAllowedApp[];
  defaultModel: DefaultModelSetting | null;
  fileOpenApplication: Omit<FileOpenApplicationSetting, "path"> | null;
  fileOpenMode: FileOpenMode;
  isSubAgentEnabled: boolean;
  outputDetail: OutputDetail;
  reasoningSummary: ReasoningSummary;
  sandboxAllowedDomains: string[];
  sandboxDeniedDomains: string[];
  sandboxProfile: SandboxProfileValue;
  windowsShellEnabled: boolean | null;
}

export class SandboxSettingsError extends Error {
  public constructor(
    public readonly status: 400 | 409 | 500,
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class AppSettingsService {
  private sandboxUpdatePending = false;

  public constructor(
    private readonly settings: AppSettingRepository,
    private readonly globalRoot: string,
    private readonly onExecutionPolicyChanged: () => Promise<void>,
  ) {}

  public async get(): Promise<AppSettings> {
    const fileOpenApplication = this.settings.getFileOpenApplication();
    const sandboxPolicy = await readSandboxPolicy(this.globalRoot);
    return {
      approvalPolicy: this.settings.getApprovalPolicy(),
      busySubmitBehavior: this.settings.getBusySubmitBehavior(),
      computerUseAllowedApps: this.settings.getComputerUseAllowedApps(),
      defaultModel: this.settings.getDefaultModel(),
      fileOpenApplication: fileOpenApplication
        ? { iconDataUrl: fileOpenApplication.iconDataUrl, name: fileOpenApplication.name }
        : null,
      fileOpenMode: this.settings.getFileOpenMode(),
      isSubAgentEnabled: this.settings.isSubAgentEnabled(),
      outputDetail: this.settings.getOutputDetail(),
      reasoningSummary: this.settings.getReasoningSummary(),
      sandboxAllowedDomains: sandboxPolicy.network.allowedDomains,
      sandboxDeniedDomains: sandboxPolicy.network.deniedDomains,
      sandboxProfile: sandboxPolicy.profile,
      windowsShellEnabled:
        process.platform === "win32"
          ? isWindowsShellEnabled(sandboxPolicy.windowsShellEnabled)
          : null,
    };
  }

  public async update(input: UpdateAppSettingsDto): Promise<AppSettings> {
    if (
      input.sandboxAllowedDomains !== undefined ||
      input.sandboxDeniedDomains !== undefined ||
      input.sandboxProfile !== undefined ||
      input.windowsShellEnabled !== undefined
    ) {
      await this.updateSandboxSettings(input);
    }
    const updatedAt = Date.now();
    if (input.approvalPolicy !== undefined) {
      const changed = input.approvalPolicy !== this.settings.getApprovalPolicy();
      this.settings.setApprovalPolicy(input.approvalPolicy, updatedAt);
      if (changed) await this.onExecutionPolicyChanged();
    }
    if (input.busySubmitBehavior !== undefined) {
      this.settings.setBusySubmitBehavior(input.busySubmitBehavior, updatedAt);
    }
    if (input.isSubAgentEnabled !== undefined) {
      this.settings.setSubAgentEnabled(input.isSubAgentEnabled, updatedAt);
    }
    if (input.defaultModel !== undefined) {
      this.settings.setDefaultModel(input.defaultModel, updatedAt);
    }
    if (input.fileOpenMode !== undefined) {
      this.settings.setFileOpenMode(input.fileOpenMode, updatedAt);
    }
    if (input.outputDetail !== undefined) {
      this.settings.setOutputDetail(input.outputDetail, updatedAt);
    }
    if (input.reasoningSummary !== undefined) {
      this.settings.setReasoningSummary(input.reasoningSummary, updatedAt);
    }
    return this.get();
  }

  private async updateSandboxSettings(input: UpdateAppSettingsDto): Promise<void> {
    if (this.sandboxUpdatePending) {
      throw new SandboxSettingsError(409, "SANDBOX_SETTINGS_BUSY", "正在更新沙箱设置，请稍后再试");
    }
    this.sandboxUpdatePending = true;
    try {
      const current = await readSandboxPolicy(this.globalRoot);
      const windowsShellEnabled = input.windowsShellEnabled ?? current.windowsShellEnabled;
      if (input.windowsShellEnabled !== undefined && process.platform !== "win32") {
        throw new SandboxSettingsError(400, "WINDOWS_SHELL_UNSUPPORTED", "此设置仅适用于 Windows");
      }
      if (
        process.platform === "win32" &&
        isWindowsShellEnabled(windowsShellEnabled) &&
        input.sandboxProfile === SandboxProfile.WORKSPACE_WRITE
      ) {
        throw new SandboxSettingsError(
          400,
          "SANDBOX_WINDOWS_READ_ONLY_REQUIRED",
          "Windows Shell 沙箱预览只支持只读，请先关闭预览再切换文件访问设置",
        );
      }
      if (input.windowsShellEnabled === true) {
        let result: Awaited<ReturnType<typeof prepareWindowsShellSandbox>>;
        try {
          result = await prepareWindowsShellSandbox();
        } catch (error: unknown) {
          const detail = error instanceof Error ? `：${error.message}` : "";
          throw new SandboxSettingsError(
            500,
            "WINDOWS_SHELL_SETUP_FAILED",
            `Windows Shell 沙箱初始化或验证失败${detail}`,
            { cause: error },
          );
        }
        if (result === "cancelled") {
          throw new SandboxSettingsError(
            409,
            "WINDOWS_SHELL_SETUP_CANCELLED",
            "已取消 Windows 沙箱初始化",
          );
        }
      }
      await writeSandboxPolicy(this.globalRoot, {
        network: {
          allowedDomains: input.sandboxAllowedDomains ?? current.network.allowedDomains,
          deniedDomains: input.sandboxDeniedDomains ?? current.network.deniedDomains,
        },
        profile:
          input.windowsShellEnabled === true
            ? SandboxProfile.READ_ONLY
            : (input.sandboxProfile ?? current.profile),
        ...(windowsShellEnabled === undefined ? {} : { windowsShellEnabled }),
      });
      await this.onExecutionPolicyChanged();
    } finally {
      this.sandboxUpdatePending = false;
    }
  }

  public revokeComputerUseApp(bundleId: string): void {
    this.settings.revokeComputerUseApp(bundleId);
  }
}
