import { Display, TrashBin } from "@gravity-ui/icons";
import { Alert, Button, Skeleton, Switch, Tooltip, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type SkillCollection,
  SkillIcon,
  skillCollectionQueryOptions,
  skillQueryKeys,
  updateSkillCollectionApp,
} from "../../skills";
import { computerUsePermissionsQueryOptions } from "../api/app-settings-queries";
import { useAppSettings } from "../hooks/use-app-settings";
import { PluginInstallButton } from "./plugin-marketplace-panel";
import { SettingsCatalogItem } from "./settings-catalog-item";
import { SettingsPanelHeader } from "./settings-panel-header";

export function ComputerUseSettingsPanel() {
  const queryClient = useQueryClient();
  const pluginQuery = useQuery(skillCollectionQueryOptions);
  const computerUsePlugin = pluginQuery.data?.find((plugin) => plugin.id === "computer-use");
  const computerUseApp = computerUsePlugin?.apps.find((app) => app.id === "computer-use");
  const updateAppMutation = useMutation({
    mutationFn: (isEnabled: boolean) =>
      updateSkillCollectionApp("computer-use", "computer-use", isEnabled),
    onMutate: async (isEnabled) => {
      await queryClient.cancelQueries({ queryKey: skillQueryKeys.collections() });
      const previousEnabled = computerUseApp?.server?.isEnabled ?? false;
      queryClient.setQueryData<SkillCollection[]>(skillQueryKeys.collections(), (plugins) =>
        plugins?.map((plugin) =>
          plugin.id === "computer-use"
            ? {
                ...plugin,
                apps: plugin.apps.map((app) =>
                  app.id === "computer-use" && app.server
                    ? { ...app, server: { ...app.server, isEnabled } }
                    : app,
                ),
              }
            : plugin,
        ),
      );
      return previousEnabled;
    },
    onError: (error: Error, _isEnabled, previousEnabled) => {
      queryClient.setQueryData<SkillCollection[]>(skillQueryKeys.collections(), (plugins) =>
        plugins?.map((plugin) =>
          plugin.id === "computer-use"
            ? {
                ...plugin,
                apps: plugin.apps.map((app) =>
                  app.id === "computer-use" && app.server
                    ? { ...app, server: { ...app.server, isEnabled: previousEnabled ?? false } }
                    : app,
                ),
              }
            : plugin,
        ),
      );
      toast.danger(error.message);
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: skillQueryKeys.collections() }),
        queryClient.invalidateQueries({ queryKey: skillQueryKeys.lists() }),
      ]),
  });
  const { error, isLoading, revokingComputerUseApp, revokeComputerUseApp, settings } =
    useAppSettings();
  const permissionsQuery = useQuery(computerUsePermissionsQueryOptions());
  const permissions = permissionsQuery.data;
  const desktopAvailable = permissions?.accessibility && permissions.screenRecording;
  const allowedApps = settings?.computerUseAllowedApps ?? [];

  const revoke = (bundleId: string) => {
    void revokeComputerUseApp(bundleId)
      .then(() => toast.success("已撤销应用授权"))
      .catch((cause: unknown) => {
        toast.danger(cause instanceof Error ? cause.message : "撤销应用授权失败");
      });
  };

  return (
    <section aria-label="电脑操控设置" className="w-full max-w-[720px]">
      <SettingsPanelHeader
        description="管理电脑操控的系统能力和可观察的本机应用。具体点击、输入和拖拽仍会在执行前单独确认。"
        title="电脑操控"
      />

      {pluginQuery.isPending ? (
        <div aria-busy="true" className="mt-5" role="status">
          <span className="sr-only">正在读取 Computer Use 插件状态</span>
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : pluginQuery.isError || !computerUsePlugin ? (
        <Alert className="mt-5" status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>无法确认 Computer Use 插件状态</Alert.Title>
            <Alert.Description>请重试，确认插件可用后再使用电脑操控。</Alert.Description>
            <Button size="sm" variant="tertiary" onPress={() => void pluginQuery.refetch()}>
              重试
            </Button>
          </Alert.Content>
        </Alert>
      ) : (
        <div className="mt-5">
          <p className="text-sm text-muted">
            {computerUsePlugin.isInstalled
              ? !computerUseApp?.server
                ? "暂时无法读取 Computer Use 应用状态，请刷新后重试。"
                : computerUseApp.server.isEnabled
                  ? "Computer Use 已开启。可在下方检测 Windows 桌面是否可用。"
                  : "请开启 Computer Use 应用，才能使用电脑操控。"
              : "电脑操控需要先安装并开启内置 Computer Use 插件。"}
          </p>
          <ul className="mt-3">
            <SettingsCatalogItem
              action={
                computerUsePlugin.isInstalled && !computerUseApp?.server ? (
                  <Button size="sm" variant="secondary" onPress={() => void pluginQuery.refetch()}>
                    重试
                  </Button>
                ) : computerUsePlugin.isInstalled ? (
                  <Switch
                    aria-label="Computer Use 应用可用状态"
                    isDisabled={updateAppMutation.isPending}
                    isSelected={computerUseApp?.server?.isEnabled ?? false}
                    size="sm"
                    onChange={(isEnabled) => updateAppMutation.mutate(isEnabled)}
                  >
                    <Switch.Content>
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                    </Switch.Content>
                  </Switch>
                ) : (
                  <PluginInstallButton plugin={computerUsePlugin} />
                )
              }
              icon={
                <SkillIcon
                  fillRaster
                  className="size-5 shrink-0 text-muted"
                  icon={computerUsePlugin.logo}
                />
              }
              name={computerUsePlugin.name}
              secondary={
                <span className="min-w-0 flex-1 truncate">{computerUsePlugin.description}</span>
              }
            />
          </ul>
        </div>
      )}

      <div className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-medium text-foreground">Windows 桌面</h3>
          <Button
            isPending={permissionsQuery.isFetching}
            size="sm"
            variant="ghost"
            onPress={() => void permissionsQuery.refetch()}
          >
            刷新状态
          </Button>
        </div>

        {permissionsQuery.isFetching ? (
          <Alert className="mt-4" status="accent" role="status">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>正在检测 Windows 桌面…</Alert.Title>
            </Alert.Content>
          </Alert>
        ) : permissionsQuery.error ? (
          <Alert className="mt-4" status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>无法检测 Windows 桌面</Alert.Title>
              <Alert.Description>{permissionsQuery.error.message}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : permissions?.supported === false ? (
          <Alert className="mt-4" status="warning">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>当前环境不支持电脑操控</Alert.Title>
              <Alert.Description>请在 Windows 11 本机登录会话中运行 CWPi。</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : permissions ? (
          <Alert className="mt-4" status={desktopAvailable ? "success" : "warning"}>
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>
                {desktopAvailable ? "Windows 桌面可用" : "Windows 桌面当前不可用"}
              </Alert.Title>
              <Alert.Description>
                请保持桌面解锁，并打开要操作的应用。管理员窗口和系统安全界面不支持操作。
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
      </div>

      <div className="mt-8">
        <h3 className="font-medium text-foreground">始终允许的应用</h3>

        {error ? (
          <Alert className="mt-4" status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>无法读取应用授权</Alert.Title>
              <Alert.Description>{error.message}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : isLoading ? (
          <div aria-busy="true" className="mt-4 space-y-2" role="status">
            <span className="sr-only">正在加载应用授权</span>
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : allowedApps.length ? (
          <ul className="mt-4 flex flex-col gap-1">
            {allowedApps.map((app) => (
              <SettingsCatalogItem
                action={
                  <Tooltip delay={0}>
                    <Button
                      isIconOnly
                      aria-label={`撤销 ${app.name} 的电脑操控授权`}
                      isPending={revokingComputerUseApp === app.bundleId}
                      size="sm"
                      variant="ghost"
                      onPress={() => revoke(app.bundleId)}
                    >
                      <TrashBin aria-hidden className="size-4 text-danger" />
                    </Button>
                    <Tooltip.Content>撤销授权</Tooltip.Content>
                  </Tooltip>
                }
                hasIconBackground={false}
                icon={<Display aria-hidden className="size-6 text-muted" />}
                key={app.bundleId}
                name={app.name}
                secondary={<span className="truncate">{app.bundleId}</span>}
              />
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-xl bg-default p-6 text-center text-sm text-muted">
            暂无始终允许的应用
          </p>
        )}
      </div>
    </section>
  );
}
