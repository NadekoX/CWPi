"use client";

import {
  AlertDialog,
  Button,
  FieldError,
  Form,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  Switch,
  TextField,
  toast,
} from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import {
  createProvider,
  deleteProvider,
  deleteProviderCredential,
  type ModelProvider,
  ProviderApiError,
  type ProviderInput,
  providerQueryKeys,
  saveProviderApiKey,
  updateProvider,
} from "../../models";
import { useProviderOAuth } from "../hooks/use-provider-oauth";
import {
  type ProviderAuthenticationMethod as AuthenticationMethod,
  defaultProviderAuthenticationMethod,
  ProviderAuthenticationMethod,
} from "../utils/provider-oauth";
import { ProviderApiKeyField } from "./provider-api-key-field";
import { ProviderOAuthPanel } from "./provider-oauth-panel";

const PROTOCOLS = [
  { id: "openai-responses", label: "OpenAI Responses" },
  { id: "openai-completions", label: "OpenAI Completions" },
  { id: "anthropic-messages", label: "Anthropic Messages" },
] as const satisfies readonly { id: ProviderInput["protocol"]; label: string }[];

function isProtocol(value: string | null): value is ProviderInput["protocol"] {
  return PROTOCOLS.some((protocol) => protocol.id === value);
}

export interface ProviderEditorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  provider: ModelProvider | null;
}

export function ProviderEditorDialog({ isOpen, onClose, provider }: ProviderEditorDialogProps) {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [authenticationMethod, setAuthenticationMethod] = useState<AuthenticationMethod>(
    ProviderAuthenticationMethod.API_KEY,
  );
  const oauth = useProviderOAuth(provider, isOpen, onClose);
  const [baseUrl, setBaseUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [name, setName] = useState("");
  const [protocol, setProtocol] = useState<ProviderInput["protocol"]>("openai-responses");
  const [requiresApiKey, setRequiresApiKey] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setApiKey("");
    setAuthenticationMethod(defaultProviderAuthenticationMethod(provider));
    setBaseUrl(provider?.baseUrl ?? "");
    setError(null);
    setName(provider?.name ?? "");
    const nextProtocol = provider?.protocol ?? null;
    setProtocol(isProtocol(nextProtocol) ? nextProtocol : "openai-responses");
    setRequiresApiKey(provider?.requiresApiKey ?? true);
  }, [isOpen, provider]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (provider?.kind === "builtin") {
        await saveProviderApiKey(provider.id, apiKey.trim());
        return;
      }

      const input: ProviderInput = {
        baseUrl: baseUrl.trim(),
        models:
          provider?.models.map(({ contextWindow, id, maxTokens, reasoning }) => ({
            contextWindow,
            id,
            maxTokens,
            reasoning,
          })) ?? [],
        name: name.trim(),
        protocol,
        requiresApiKey,
      };
      const saved = provider
        ? await updateProvider(provider.id, input)
        : await createProvider(input);
      if (requiresApiKey && apiKey.trim()) {
        await saveProviderApiKey(saved.id, apiKey.trim());
      }
    },
    onError: (mutationError) => {
      if (mutationError instanceof ProviderApiError && mutationError.status === 400) {
        setError(mutationError.message);
        return;
      }
      toast.danger(mutationError.message);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: providerQueryKeys.all }),
    onSuccess: onClose,
  });

  const removeCredentialMutation = useMutation({
    mutationFn: async () => {
      if (provider) await deleteProviderCredential(provider.id);
    },
    onError: (mutationError) => toast.danger(mutationError.message),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: providerQueryKeys.all });
      onClose();
    },
  });

  const removeProviderMutation = useMutation({
    mutationFn: async () => {
      if (provider) await deleteProvider(provider.id);
    },
    onError: (mutationError) => {
      toast.danger(mutationError.message);
      setIsDeleteOpen(false);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: providerQueryKeys.all });
      setIsDeleteOpen(false);
      onClose();
    },
  });

  const handleClose = () => {
    void oauth
      .close()
      .catch((closeError: unknown) =>
        toast.danger(closeError instanceof Error ? closeError.message : "取消授权失败"),
      );
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      authenticationMethod === ProviderAuthenticationMethod.OAUTH ||
      oauth.isActive ||
      oauth.isBusy
    )
      return;
    setError(null);
    saveMutation.mutate();
  };

  const isSaveDisabled =
    saveMutation.isPending ||
    oauth.isActive ||
    oauth.isBusy ||
    (provider?.kind === "builtin" && !apiKey.trim()) ||
    (provider?.kind !== "builtin" && (!name.trim() || !baseUrl.trim()));

  return (
    <>
      <Modal.Backdrop
        isOpen={isOpen}
        onOpenChange={(nextIsOpen) => {
          if (!nextIsOpen) handleClose();
        }}
      >
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-lg">
            <Modal.Header>
              <Modal.Heading>{provider ? `配置 ${provider.name}` : "添加 Provider"}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <Form
                aria-label="Provider 配置"
                className="flex flex-col gap-4 [--field-border-focus:var(--accent)] [--field-border-width:2px]"
                id="provider-form"
                onSubmit={handleSubmit}
              >
                <div className="flex flex-col gap-4">
                  {provider?.kind !== "builtin" ? (
                    <>
                      <TextField
                        isRequired
                        fullWidth
                        name="name"
                        value={name}
                        variant="secondary"
                        onChange={setName}
                      >
                        <Label>名称</Label>
                        <Input placeholder="例如：OpenAI" />
                        <FieldError />
                      </TextField>
                      <Select
                        aria-label="Provider 协议"
                        isRequired
                        name="protocol"
                        value={protocol}
                        variant="secondary"
                        onChange={(key) => {
                          const value = String(key);
                          if (isProtocol(value)) setProtocol(value);
                        }}
                      >
                        <Label>协议</Label>
                        <Select.Trigger>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            {PROTOCOLS.map((item) => (
                              <ListBox.Item key={item.id} id={item.id} textValue={item.label}>
                                <Label>{item.label}</Label>
                                <ListBox.ItemIndicator />
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                      <TextField
                        isRequired
                        fullWidth
                        name="baseUrl"
                        value={baseUrl}
                        variant="secondary"
                        onChange={setBaseUrl}
                      >
                        <Label>Base URL</Label>
                        <Input placeholder="https://api.example.com/v1" type="url" />
                        <FieldError />
                      </TextField>
                      <Switch
                        isSelected={requiresApiKey}
                        name="requiresApiKey"
                        onChange={setRequiresApiKey}
                      >
                        <Switch.Content>
                          <Label>需要 API Key</Label>
                          <Switch.Control>
                            <Switch.Thumb />
                          </Switch.Control>
                        </Switch.Content>
                      </Switch>
                    </>
                  ) : null}

                  {provider?.supportsOAuth && provider.requiresApiKey ? (
                    <Select
                      aria-label="认证方式"
                      isDisabled={oauth.isActive || oauth.isBusy || saveMutation.isPending}
                      value={authenticationMethod}
                      variant="secondary"
                      onChange={(key) => {
                        if (
                          key === ProviderAuthenticationMethod.API_KEY ||
                          key === ProviderAuthenticationMethod.OAUTH
                        )
                          setAuthenticationMethod(key);
                      }}
                    >
                      <Label>认证方式</Label>
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item
                            id={ProviderAuthenticationMethod.API_KEY}
                            textValue="API Key"
                          >
                            <Label>API Key</Label>
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                          <ListBox.Item
                            id={ProviderAuthenticationMethod.OAUTH}
                            textValue="OAuth 登录"
                          >
                            <Label>OAuth 登录</Label>
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  ) : null}
                  {provider?.supportsOAuth &&
                  authenticationMethod === ProviderAuthenticationMethod.OAUTH ? (
                    <ProviderOAuthPanel
                      state={oauth.state}
                      isBusy={oauth.isBusy}
                      isStarting={oauth.start.isPending}
                      onStart={() => oauth.start.mutate(provider.id)}
                      onCancel={() => oauth.cancel.mutate(provider.id)}
                      onAnswer={(promptId, value) =>
                        oauth.answer.mutate({ providerId: provider.id, promptId, value })
                      }
                    />
                  ) : requiresApiKey ? (
                    <ProviderApiKeyField
                      credentialPreview={provider?.credentialPreview ?? null}
                      key={`${provider?.id ?? "new"}:${isOpen}`}
                      value={apiKey}
                      onChange={setApiKey}
                    />
                  ) : null}
                </div>
                {error ? (
                  <p className="text-sm text-danger" role="alert">
                    {error}
                  </p>
                ) : null}
              </Form>
            </Modal.Body>
            <Modal.Footer className="justify-between">
              <div className="flex gap-2">
                {provider?.canDelete ? (
                  <Button type="button" variant="danger" onPress={() => setIsDeleteOpen(true)}>
                    删除 Provider
                  </Button>
                ) : null}
                {provider?.hasStoredCredential ? (
                  <Button
                    isDisabled={
                      removeCredentialMutation.isPending || oauth.isActive || oauth.isBusy
                    }
                    type="button"
                    variant="tertiary"
                    onPress={() => removeCredentialMutation.mutate()}
                  >
                    移除凭据
                  </Button>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Button
                  isDisabled={oauth.isBusy}
                  type="button"
                  variant="tertiary"
                  onPress={handleClose}
                >
                  取消
                </Button>
                {authenticationMethod !== ProviderAuthenticationMethod.OAUTH ? (
                  <Button form="provider-form" isDisabled={isSaveDisabled} type="submit">
                    {saveMutation.isPending ? "保存中…" : provider ? "保存" : "添加"}
                  </Button>
                ) : null}
              </div>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <AlertDialog.Backdrop isOpen={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[420px]">
            <AlertDialog.Header>
              <AlertDialog.Icon status="warning" />
              <AlertDialog.Heading>删除 {provider?.name}？</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>该 Provider 的配置和本地凭据都会被删除，此操作无法撤销。</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                取消
              </Button>
              <Button
                isDisabled={removeProviderMutation.isPending}
                variant="danger"
                onPress={() => removeProviderMutation.mutate()}
              >
                确认删除
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  );
}
