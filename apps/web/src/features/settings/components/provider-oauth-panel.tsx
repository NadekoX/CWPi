"use client";

import {
  Button,
  Description,
  Input,
  Label,
  ListBox,
  Select,
  TextField,
  toast,
} from "@heroui/react";
import { useState } from "react";
import {
  ProviderOAuthPromptType,
  type ProviderOAuthState,
  ProviderOAuthStatus,
} from "../../models";
import { isProviderOAuthActive, openProviderOAuthPage } from "../utils/provider-oauth";

type OAuthInputState = Extract<
  ProviderOAuthState,
  { status: typeof ProviderOAuthStatus.AWAITING_INPUT }
>;

function ProviderOAuthPrompt({
  state,
  isBusy,
  onAnswer,
}: {
  state: OAuthInputState;
  isBusy: boolean;
  onAnswer: (promptId: string, value: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="flex flex-col gap-3">
      {state.promptType === ProviderOAuthPromptType.SELECT ? (
        <Select
          aria-label="授权选项"
          isDisabled={isBusy}
          value={value || null}
          variant="secondary"
          onChange={(key) => setValue(key === null ? "" : String(key))}
        >
          <Label>{state.message}</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover className="max-w-[calc(100vw-2rem)]">
            <ListBox>
              {state.options.map((option) => (
                <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
                  <Label>{option.label}</Label>
                  {option.description ? <Description>{option.description}</Description> : null}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      ) : (
        <TextField
          isDisabled={isBusy}
          name="oauthAnswer"
          value={value}
          variant="secondary"
          onChange={setValue}
        >
          <Label>{state.message}</Label>
          <Input
            autoComplete="off"
            placeholder={state.placeholder ?? "输入授权结果"}
            type={state.promptType === ProviderOAuthPromptType.SECRET ? "password" : "text"}
          />
        </TextField>
      )}
      <Button
        isDisabled={isBusy || !value.trim()}
        type="button"
        variant="secondary"
        onPress={() => onAnswer(state.promptId, value)}
      >
        继续授权
      </Button>
    </div>
  );
}

export function ProviderOAuthPanel({
  state,
  isBusy,
  isStarting,
  onStart,
  onCancel,
  onAnswer,
}: {
  state: ProviderOAuthState | null;
  isBusy: boolean;
  isStarting: boolean;
  onStart: () => void;
  onCancel: () => void;
  onAnswer: (promptId: string, value: string) => void;
}) {
  const authorizationUrl = state && "authorizationUrl" in state ? state.authorizationUrl : null;
  return (
    <div className="flex flex-col gap-3">
      {!state || state.status !== ProviderOAuthStatus.AWAITING_INPUT ? (
        <p
          className={
            state?.status === ProviderOAuthStatus.FAILED
              ? "text-sm text-danger"
              : "text-sm text-muted"
          }
          role="status"
        >
          {state?.message ?? "使用服务商账号授权，凭据只保存在本地 daemon。"}
        </p>
      ) : null}
      {authorizationUrl ? (
        <Button
          type="button"
          variant="secondary"
          onPress={() => {
            void openProviderOAuthPage(authorizationUrl).catch((error: unknown) =>
              toast.danger(error instanceof Error ? error.message : "无法打开授权页面"),
            );
          }}
        >
          打开授权页面
        </Button>
      ) : null}
      {state && "userCode" in state && state.userCode ? (
        <TextField isReadOnly value={state.userCode}>
          <Label>设备验证码</Label>
          <Input />
        </TextField>
      ) : null}
      {state?.status === ProviderOAuthStatus.AWAITING_INPUT ? (
        <ProviderOAuthPrompt
          key={state.promptId}
          state={state}
          isBusy={isBusy}
          onAnswer={onAnswer}
        />
      ) : null}
      {isProviderOAuthActive(state) ? (
        <Button isDisabled={isBusy} type="button" variant="tertiary" onPress={onCancel}>
          取消授权
        </Button>
      ) : (
        <Button isPending={isStarting} isDisabled={isBusy} type="button" onPress={onStart}>
          {state?.status === ProviderOAuthStatus.FAILED ? "重新授权" : "开始 OAuth 登录"}
        </Button>
      )}
    </div>
  );
}
