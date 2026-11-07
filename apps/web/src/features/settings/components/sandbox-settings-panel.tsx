"use client";

import { SandboxProfile } from "@cwpi/policy/sandbox-profile";
import {
  AlertDialog,
  Button,
  Description,
  FieldError,
  Label,
  ListBox,
  Select,
  Separator,
  Skeleton,
  Switch,
  TextArea,
  TextField,
  toast,
} from "@heroui/react";
import { useEffect, useState } from "react";
import { useAppSettings } from "../hooks/use-app-settings";
import { SettingsPanelHeader } from "./settings-panel-header";
import { SettingsRow } from "./settings-row";

const SANDBOX_NETWORK_PATTERN =
  /^(?:(?:\*\.)?[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?|\[[0-9a-fA-F:]+\])(?::\d{1,5})?$/u;

function SandboxNetworkSetting({
  allowedDomains,
  deniedDomains,
  isSaving,
  onSave,
}: {
  allowedDomains: string[];
  deniedDomains: string[];
  isSaving: boolean;
  onSave: (policy: { allowedDomains: string[]; deniedDomains: string[] }) => Promise<unknown>;
}) {
  const [allowedDraft, setAllowedDraft] = useState(allowedDomains.join("\n"));
  const [deniedDraft, setDeniedDraft] = useState(deniedDomains.join("\n"));
  const parse = (draft: string) => [
    ...new Set(
      draft
        .split(/[,\s]+/u)
        .map((domain) => domain.trim().toLocaleLowerCase())
        .filter(Boolean),
    ),
  ];
  const parsedAllowedDomains = parse(allowedDraft);
  const parsedDeniedDomains = parse(deniedDraft);
  const isAllowedInvalid =
    parsedAllowedDomains.length > 100 ||
    parsedAllowedDomains.some((entry) => !SANDBOX_NETWORK_PATTERN.test(entry));
  const isDeniedInvalid =
    parsedDeniedDomains.length > 100 ||
    parsedDeniedDomains.some(
      (entry) =>
        entry !== "*" && !/^\*:\d{1,5}$/u.test(entry) && !SANDBOX_NETWORK_PATTERN.test(entry),
    );

  useEffect(() => setAllowedDraft(allowedDomains.join("\n")), [allowedDomains]);
  useEffect(() => setDeniedDraft(deniedDomains.join("\n")), [deniedDomains]);

  return (
    <div className="mt-4 min-w-0">
      <div className="grid min-w-0 gap-4 @lg/settings:grid-cols-2">
        <TextField
          fullWidth
          isInvalid={isAllowedInvalid}
          value={allowedDraft}
          variant="secondary"
          onChange={setAllowedDraft}
        >
          <Label>允许访问</Label>
          <TextArea rows={4} placeholder={"github.com:443\n*.githubusercontent.com"} />
          <Description>留空时允许所有未被拒绝的目标；每行一个域名、IP 或带端口规则。</Description>
          <FieldError>请输入有效的允许规则</FieldError>
        </TextField>

        <TextField
          fullWidth
          isInvalid={isDeniedInvalid}
          value={deniedDraft}
          variant="secondary"
          onChange={setDeniedDraft}
        >
          <Label>拒绝访问</Label>
          <TextArea rows={4} placeholder={"169.254.169.254\n*:22"} />
          <Description>拒绝规则优先，可使用 * 或 *:port。</Description>
          <FieldError>请输入有效的拒绝规则</FieldError>
        </TextField>
      </div>

      <div className="mt-4 flex justify-end">
        <Button
          size="sm"
          isDisabled={isAllowedInvalid || isDeniedInvalid}
          isPending={isSaving}
          variant="secondary"
          onPress={() => {
            void onSave({
              allowedDomains: parsedAllowedDomains,
              deniedDomains: parsedDeniedDomains,
            });
          }}
        >
          保存联网规则
        </Button>
      </div>
    </div>
  );
}

export function SandboxSettingsPanel() {
  const { isSaving, settings, updateSettings } = useAppSettings();
  const [isWindowsShellDialogOpen, setIsWindowsShellDialogOpen] = useState(false);
  const sandboxAllowedDomains = settings?.sandboxAllowedDomains;
  const sandboxDeniedDomains = settings?.sandboxDeniedDomains;
  const sandboxProfile = settings?.sandboxProfile;
  const windowsShellEnabled = settings?.windowsShellEnabled;
  const isSavingWindowsShell = isSaving("windowsShellEnabled");
  const isSavingNetwork = isSaving("sandboxAllowedDomains") || isSaving("sandboxDeniedDomains");
  const isWindowsShellReadOnly =
    windowsShellEnabled === true && sandboxProfile === SandboxProfile.READ_ONLY;

  function updateWindowsShell(enabled: boolean) {
    void updateSettings({ windowsShellEnabled: enabled })
      .then(() =>
        toast.success(enabled ? "已启用 Windows Shell 沙箱" : "已关闭 Windows Shell 沙箱"),
      )
      .catch((error: unknown) => {
        toast.danger(error instanceof Error ? error.message : "保存 Windows Shell 沙箱设置失败");
      });
  }

  return (
    <section aria-label="沙箱设置" className="w-full max-w-[720px]">
      <SettingsPanelHeader
        description="在非完全访问模式下配置本地命令与 MCP 的文件访问和联网边界。"
        title="沙箱"
      />

      <div className="mt-1">
        {windowsShellEnabled == null ? null : (
          <>
            <SettingsRow
              description={
                isSavingWindowsShell
                  ? "正在更新设置。若出现 Windows 管理员确认，请在弹窗中处理。"
                  : "在 Windows 上以只读沙箱执行 Shell 命令。首次启用可能需要管理员确认。"
              }
              title="Windows Shell 沙箱（预览）"
            >
              <Switch
                aria-label="启用 Windows Shell 沙箱"
                className="justify-self-start @xl/settings:justify-self-end"
                isDisabled={isSavingWindowsShell || isSavingNetwork || isSaving("sandboxProfile")}
                isSelected={windowsShellEnabled}
                onChange={(enabled) => {
                  if (enabled) setIsWindowsShellDialogOpen(true);
                  else updateWindowsShell(false);
                }}
              >
                <Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch.Content>
              </Switch>
            </SettingsRow>
            <Separator />
          </>
        )}

        <SettingsRow
          description={
            isWindowsShellReadOnly
              ? "Windows Shell 沙箱预览开启时，文件访问固定为只读。"
              : "限制本地命令与 MCP 对工作区的写入范围。"
          }
          title="文件访问"
        >
          {sandboxProfile === undefined ? (
            <Skeleton aria-hidden className="h-10 w-full rounded-xl @xl/settings:w-48" />
          ) : (
            <Select
              aria-label="沙箱 Profile"
              className="w-full @xl/settings:w-48"
              isDisabled={
                isSaving("sandboxProfile") || isSavingWindowsShell || isWindowsShellReadOnly
              }
              selectedKey={sandboxProfile}
              variant="secondary"
              onSelectionChange={(key) => {
                if (key !== SandboxProfile.READ_ONLY && key !== SandboxProfile.WORKSPACE_WRITE)
                  return;
                void updateSettings({ sandboxProfile: key }).catch((error: unknown) => {
                  toast.danger(error instanceof Error ? error.message : "保存沙箱 Profile 失败");
                });
              }}
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id={SandboxProfile.READ_ONLY} textValue="只读">
                    <Label>只读</Label>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                  <ListBox.Item id={SandboxProfile.WORKSPACE_WRITE} textValue="工作区可写">
                    <Label>工作区可写</Label>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
          )}
        </SettingsRow>

        <Separator />

        <div className="py-5 @xl/settings:py-6">
          <h3 className="font-medium text-foreground">联网规则</h3>
          <p className="mt-1 max-w-xl text-sm text-muted">
            拒绝规则优先；允许访问留空时默认放行，本地命令未命中非空列表时可请求临时授权。
          </p>
          {sandboxAllowedDomains === undefined || sandboxDeniedDomains === undefined ? (
            <div className="mt-4 grid gap-4 @lg/settings:grid-cols-2">
              <Skeleton aria-hidden className="h-32 w-full rounded-xl" />
              <Skeleton aria-hidden className="h-32 w-full rounded-xl" />
            </div>
          ) : (
            <SandboxNetworkSetting
              allowedDomains={sandboxAllowedDomains}
              deniedDomains={sandboxDeniedDomains}
              isSaving={isSavingNetwork || isSavingWindowsShell}
              onSave={async ({ allowedDomains, deniedDomains }) => {
                try {
                  await updateSettings({
                    sandboxAllowedDomains: allowedDomains,
                    sandboxDeniedDomains: deniedDomains,
                  });
                  toast.success("联网规则已保存");
                } catch (error: unknown) {
                  toast.danger(error instanceof Error ? error.message : "保存沙箱联网设置失败");
                }
              }}
            />
          )}
        </div>
      </div>

      <AlertDialog.Backdrop
        isOpen={isWindowsShellDialogOpen}
        onOpenChange={setIsWindowsShellDialogOpen}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[420px]">
            <AlertDialog.Header>
              <AlertDialog.Icon status="warning" />
              <AlertDialog.Heading>启用 Windows Shell 沙箱？</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>
                首次启用时，Windows
                可能要求管理员确认，以创建专用沙箱账户并配置网络隔离。初始化会跳过用户目录的批量授权。启用后，文件访问会设为只读。
              </p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                取消
              </Button>
              <Button
                onPress={() => {
                  setIsWindowsShellDialogOpen(false);
                  updateWindowsShell(true);
                }}
              >
                初始化并启用
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </section>
  );
}
