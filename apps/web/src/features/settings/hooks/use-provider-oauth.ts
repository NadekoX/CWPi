import { toast } from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  answerProviderOAuthPrompt,
  cancelProviderOAuth,
  getProviderOAuthState,
  type ModelProvider,
  type ProviderOAuthState,
  ProviderOAuthStatus,
  providerQueryKeys,
  startProviderOAuth,
} from "../../models";
import { isProviderOAuthActive } from "../utils/provider-oauth";

export function useProviderOAuth(
  provider: ModelProvider | null,
  isOpen: boolean,
  onComplete: () => void,
) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ProviderOAuthState | null>(null);
  const activeProviderRef = useRef<string | null>(null);
  const startTaskRef = useRef<Promise<ProviderOAuthState> | null>(null);
  useEffect(() => {
    if (isOpen) setState(null);
  }, [isOpen, provider?.id]);

  const acceptState = async (nextState: ProviderOAuthState) => {
    if (activeProviderRef.current !== nextState.providerId) return;
    setState(nextState);
    if (!isProviderOAuthActive(nextState)) activeProviderRef.current = null;
    if (nextState.status === ProviderOAuthStatus.COMPLETED) {
      await queryClient.invalidateQueries({ queryKey: providerQueryKeys.all });
      toast.success("模型服务授权成功");
      onComplete();
    }
  };
  const start = useMutation({
    mutationFn: (providerId: string) => {
      activeProviderRef.current = providerId;
      const task = startProviderOAuth(providerId);
      startTaskRef.current = task;
      return task;
    },
    onSuccess: acceptState,
    onError: (error) => toast.danger(error.message),
  });
  const poll = useMutation({
    mutationFn: getProviderOAuthState,
    onSuccess: acceptState,
    onError: (error) => {
      setState(null);
      toast.danger(error.message);
    },
  });
  const answer = useMutation({
    mutationFn: async ({
      providerId,
      promptId,
      value,
    }: {
      providerId: string;
      promptId: string;
      value: string;
    }) => {
      await answerProviderOAuthPrompt(providerId, promptId, value);
      return getProviderOAuthState(providerId);
    },
    onSuccess: acceptState,
    onError: (error) => toast.danger(error.message),
  });
  const cancel = useMutation({
    mutationFn: cancelProviderOAuth,
    onSuccess: () => {
      activeProviderRef.current = null;
      setState(null);
    },
    onError: (error) => toast.danger(error.message),
  });
  const isActive = isProviderOAuthActive(state);
  const isBusy = start.isPending || answer.isPending || cancel.isPending;
  useEffect(() => {
    if (!isOpen || !provider || !isActive || isBusy || poll.isPending) return;
    const timer = window.setTimeout(() => poll.mutate(provider.id), 1_000);
    return () => window.clearTimeout(timer);
  }, [isOpen, provider, isActive, isBusy, poll.isPending, poll.mutate]);

  useEffect(
    () => () => {
      const providerId = activeProviderRef.current;
      if (!providerId) return;
      activeProviderRef.current = null;
      async function cancelAfterStart(id: string) {
        try {
          await startTaskRef.current;
        } finally {
          await cancelProviderOAuth(id);
        }
      }
      void cancelAfterStart(providerId).catch((error: unknown) =>
        toast.danger(error instanceof Error ? error.message : "取消模型授权失败"),
      );
    },
    [],
  );

  const close = async () => {
    if (isBusy) return;
    if (activeProviderRef.current) await cancel.mutateAsync(activeProviderRef.current);
    onComplete();
  };
  return { state, isActive, isBusy, start, poll, answer, cancel, close };
}
