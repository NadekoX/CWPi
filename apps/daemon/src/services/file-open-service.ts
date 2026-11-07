import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import {
  FileOpenMode,
  FileOpenResultStatus,
  type FileOpenResultStatus as FileOpenResultStatusValue,
} from "../schemas/file-open.js";
import type { AppSettingRepository, FileOpenApplicationSetting } from "../storage/database.js";

const PICKER_TIMEOUT_MS = 5 * 60 * 1_000;
const OPEN_TIMEOUT_MS = 10_000;
const LINUX_FILE_MANAGER_NAMES = new Set([
  "caja",
  "dolphin",
  "nautilus",
  "nemo",
  "pcmanfm",
  "pcmanfm-qt",
  "thunar",
]);

interface FileOpenCommand {
  args: readonly string[];
  command: string;
  env?: NodeJS.ProcessEnv;
}

export const FileOpenErrorCode = {
  OPEN_FAILED: "FILE_OPEN_FAILED",
  OPEN_UNAVAILABLE: "FILE_OPEN_UNAVAILABLE",
  PICKER_BUSY: "FILE_OPEN_PICKER_BUSY",
  PICKER_FAILED: "FILE_OPEN_PICKER_FAILED",
  PICKER_UNAVAILABLE: "FILE_OPEN_PICKER_UNAVAILABLE",
} as const;

export type FileOpenErrorCode = (typeof FileOpenErrorCode)[keyof typeof FileOpenErrorCode];

export class FileOpenServiceError extends Error {
  public constructor(
    public readonly code: FileOpenErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FileOpenServiceError";
  }
}

function isPickerCancellation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return process.platform === "linux" && "code" in error && error.code === 1;
}

function runText(
  command: string,
  args: readonly string[],
  signal: AbortSignal,
  timeout: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { encoding: "utf8", maxBuffer: 16_384, signal, timeout },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout.trim());
      },
    );
  });
}

function runWithoutOutput(
  { command, args, env }: FileOpenCommand,
  signal: AbortSignal,
  timeout: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], { env, maxBuffer: 4_096, signal, timeout }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function readApplicationPickerCommand(): { args: readonly string[]; command: string } {
  if (process.platform === "win32") {
    return {
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-STA",
        "-Command",
        "Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.OpenFileDialog; $dialog.Title = '选择用于打开文件的应用'; $dialog.Filter = '应用程序 (*.exe)|*.exe'; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.FileName) }",
      ],
      command: "powershell.exe",
    };
  }
  if (process.platform === "linux") {
    return {
      args: ["--file-selection", "--title=选择用于打开文件的应用"],
      command: "zenity",
    };
  }
  throw new FileOpenServiceError(
    FileOpenErrorCode.PICKER_UNAVAILABLE,
    "当前操作系统不支持应用选择器",
  );
}

function readSystemOpenCommand(path: string): FileOpenCommand {
  if (process.platform === "win32") {
    return {
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Start-Process -FilePath $env:CWPI_OPEN_TARGET -ErrorAction Stop",
      ],
      command: "powershell.exe",
      env: { ...process.env, CWPI_OPEN_TARGET: path },
    };
  }
  if (process.platform === "linux") return { args: [path], command: "xdg-open" };
  throw new FileOpenServiceError(
    FileOpenErrorCode.OPEN_UNAVAILABLE,
    "当前操作系统不支持打开本地路径",
  );
}

function readApplicationOpenCommand(applicationPath: string, targetPath: string): FileOpenCommand {
  if (process.platform === "win32") {
    if (basename(applicationPath).toLowerCase() === "explorer.exe") {
      return { args: [`/select,${targetPath}`], command: applicationPath };
    }
    return {
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Start-Process -FilePath $env:CWPI_OPEN_APPLICATION -ArgumentList ([string][char]34 + $env:CWPI_OPEN_TARGET + [char]34) -ErrorAction Stop",
      ],
      command: "powershell.exe",
      env: {
        ...process.env,
        CWPI_OPEN_APPLICATION: applicationPath,
        CWPI_OPEN_TARGET: targetPath,
      },
    };
  }
  if (process.platform === "linux") {
    if (LINUX_FILE_MANAGER_NAMES.has(basename(applicationPath).toLowerCase())) {
      return { args: [dirname(targetPath)], command: applicationPath };
    }
    return { args: [targetPath], command: applicationPath };
  }
  throw new FileOpenServiceError(
    FileOpenErrorCode.OPEN_UNAVAILABLE,
    "当前操作系统不支持指定应用打开文件",
  );
}

async function readApplication(applicationPath: string): Promise<FileOpenApplicationSetting> {
  const path = await realpath(applicationPath);
  const applicationStat = await stat(path);
  if (!applicationStat.isFile()) {
    throw new FileOpenServiceError(FileOpenErrorCode.PICKER_FAILED, "选择的项目不是可用应用");
  }
  return {
    iconDataUrl: null,
    name: basename(path, extname(path)),
    path,
  };
}

export class FileOpenService {
  private activePickerController: AbortController | null = null;

  public constructor(private readonly settings: AppSettingRepository) {}

  public close(): void {
    this.activePickerController?.abort();
  }

  public async open(
    targetPath: string,
    rememberApplication: boolean | undefined,
    signal: AbortSignal,
  ): Promise<FileOpenResultStatusValue> {
    if ((await stat(targetPath)).isDirectory()) {
      await this.openSystem(targetPath, signal);
      return FileOpenResultStatus.OPENED;
    }

    if (rememberApplication !== undefined) {
      const application = await this.selectApplication(signal);
      if (!application) return FileOpenResultStatus.CANCELLED;
      await this.openWithApplication(application, targetPath, signal);
      if (rememberApplication) {
        const updatedAt = Date.now();
        this.settings.setFileOpenApplication(application, updatedAt);
        this.settings.setFileOpenMode(FileOpenMode.ALWAYS, updatedAt);
      }
      return FileOpenResultStatus.OPENED;
    }

    const application = this.settings.getFileOpenApplication();
    if (this.settings.getFileOpenMode() === FileOpenMode.ASK || !application) {
      return FileOpenResultStatus.APPLICATION_REQUIRED;
    }
    try {
      await this.openWithApplication(application, targetPath, signal);
      return FileOpenResultStatus.OPENED;
    } catch (error: unknown) {
      if (
        error instanceof FileOpenServiceError &&
        (error.code === FileOpenErrorCode.OPEN_FAILED ||
          error.code === FileOpenErrorCode.OPEN_UNAVAILABLE)
      ) {
        return FileOpenResultStatus.APPLICATION_REQUIRED;
      }
      throw error;
    }
  }

  public async openSystem(path: string, signal: AbortSignal): Promise<void> {
    const command = readSystemOpenCommand(path);
    try {
      await runWithoutOutput(command, signal, OPEN_TIMEOUT_MS);
    } catch (error: unknown) {
      if (signal.aborted) return;
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new FileOpenServiceError(
          FileOpenErrorCode.OPEN_UNAVAILABLE,
          "当前系统缺少可用的本地路径打开程序",
        );
      }
      throw new FileOpenServiceError(FileOpenErrorCode.OPEN_FAILED, "无法打开本地路径");
    }
  }

  public async selectDefaultApplication(signal: AbortSignal): Promise<boolean> {
    const application = await this.selectApplication(signal);
    if (!application) return false;
    const updatedAt = Date.now();
    this.settings.setFileOpenApplication(application, updatedAt);
    this.settings.setFileOpenMode(FileOpenMode.ALWAYS, updatedAt);
    return true;
  }

  private async openWithApplication(
    application: FileOpenApplicationSetting,
    targetPath: string,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const applicationPath = await realpath(application.path);
      await runWithoutOutput(
        readApplicationOpenCommand(applicationPath, targetPath),
        signal,
        OPEN_TIMEOUT_MS,
      );
    } catch (error: unknown) {
      if (signal.aborted) return;
      if (error instanceof FileOpenServiceError) throw error;
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new FileOpenServiceError(
          FileOpenErrorCode.OPEN_UNAVAILABLE,
          "当前系统缺少已选择的应用",
        );
      }
      throw new FileOpenServiceError(FileOpenErrorCode.OPEN_FAILED, "已选择的应用无法打开该文件");
    }
  }

  private async selectApplication(signal: AbortSignal): Promise<FileOpenApplicationSetting | null> {
    if (this.activePickerController) {
      throw new FileOpenServiceError(FileOpenErrorCode.PICKER_BUSY, "已有应用选择器正在等待操作");
    }

    const pickerController = new AbortController();
    this.activePickerController = pickerController;
    const pickerSignal = AbortSignal.any([signal, pickerController.signal]);
    try {
      const { args, command } = readApplicationPickerCommand();
      const applicationPath = await runText(command, args, pickerSignal, PICKER_TIMEOUT_MS);
      return applicationPath ? await readApplication(applicationPath) : null;
    } catch (error: unknown) {
      if (pickerSignal.aborted || isPickerCancellation(error)) return null;
      if (error instanceof FileOpenServiceError) throw error;
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new FileOpenServiceError(
          FileOpenErrorCode.PICKER_UNAVAILABLE,
          "当前系统缺少可用的应用选择器",
        );
      }
      throw new FileOpenServiceError(FileOpenErrorCode.PICKER_FAILED, "打开应用选择器失败");
    } finally {
      if (this.activePickerController === pickerController) this.activePickerController = null;
    }
  }
}
