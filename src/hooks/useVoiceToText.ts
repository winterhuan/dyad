import { useCallback, useEffect, useState } from "react";
import { systemClock, uuidIdSource } from "@/state_machines/clock";
import {
  useControllerSnapshot,
  useManagerLifecycle,
} from "@/state_machines/react";
import { createBrowserVoiceCommandRunner } from "@/voice_to_text/commands";
import {
  isVoiceRecording,
  isVoiceTranscribing,
  VoiceToTextController,
} from "@/voice_to_text/controller";

export function useVoiceToText(options: {
  enabled: boolean;
  onTranscription: (text: string) => void;
  onError?: (error: string) => void;
}) {
  const { enabled, onTranscription, onError } = options;
  const [{ controller, runner }] = useState(() => {
    const runner = createBrowserVoiceCommandRunner({
      clock: systemClock,
      idSource: uuidIdSource,
      callbacks: { onTranscription, onError },
    });
    return {
      runner,
      controller: new VoiceToTextController({
        idSource: uuidIdSource,
        runner,
      }),
    };
  });
  useManagerLifecycle(controller);
  useEffect(
    () => runner.updateCallbacks({ onTranscription, onError }),
    [runner, onTranscription, onError],
  );
  const state = useControllerSnapshot(controller);
  const toggleRecording = useCallback(() => {
    if (enabled || isVoiceRecording(controller.getSnapshot())) {
      controller.toggle();
    }
  }, [controller, enabled]);
  return {
    isRecording: isVoiceRecording(state),
    isTranscribing: isVoiceTranscribing(state),
    toggleRecording,
  };
}
