"use client";

import { Eye, EyeSlash as EyeOff } from "@gravity-ui/icons";
import { Button, InputGroup, Label, TextField, Tooltip } from "@heroui/react";
import { useState } from "react";

interface ProviderApiKeyFieldProps {
  credentialPreview: string | null;
  onChange: (value: string) => void;
  value: string;
}

export function ProviderApiKeyField({
  credentialPreview,
  onChange,
  value,
}: ProviderApiKeyFieldProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <TextField fullWidth name="apiKey" value={value} onChange={onChange}>
      <Label>API Key</Label>
      <InputGroup fullWidth variant="secondary">
        <InputGroup.Input
          autoComplete="off"
          placeholder={credentialPreview ?? "输入 API Key"}
          type={isVisible ? "text" : "password"}
        />
        <InputGroup.Suffix>
          <Tooltip delay={0}>
            <Button
              isIconOnly
              aria-label={isVisible ? "隐藏 API Key" : "显示 API Key"}
              size="sm"
              type="button"
              variant="tertiary"
              onPress={() => setIsVisible((current) => !current)}
            >
              {isVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
            <Tooltip.Content>{isVisible ? "隐藏 API Key" : "显示 API Key"}</Tooltip.Content>
          </Tooltip>
        </InputGroup.Suffix>
      </InputGroup>
    </TextField>
  );
}
