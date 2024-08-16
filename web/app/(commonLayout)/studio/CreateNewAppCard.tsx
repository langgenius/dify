"use client";
import * as React from "react";
import { useState } from "react";
import { Button } from "@/app/components/base/button";
import CreateAppModal from "@/app/components/app/create-app-modal";
import { useProviderContext } from "@/context/provider-context";

interface CreateNewAppCardProps {
  onSuccess?: () => void;
}

export default function CreateNewAppCard({ onSuccess }: CreateNewAppCardProps) {
  const [showNewAppModal, setShowNewAppModal] = useState(false);
  const { onPlanInfoChanged } = useProviderContext();

  return (
    <>
      <Button variant={"primary"} onClick={() => setShowNewAppModal(true)}>
        Create +
      </Button>

      <CreateAppModal
        show={showNewAppModal}
        onClose={() => setShowNewAppModal(false)}
        onSuccess={() => {
          onPlanInfoChanged();
          if (onSuccess) onSuccess();
        }}
      />
    </>
  );
}
