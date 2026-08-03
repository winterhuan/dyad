import {
  TransactionalDispatcher,
  type DispatcherError,
} from "@/state_machines/dispatcher";
import type { IdSource } from "@/state_machines/clock";
import type { TransitionObserver } from "@/state_machines/types";
import type { VoiceCommand, VoiceEvent, VoiceState } from "./state";
import { transition } from "./transition";

export interface VoiceCommandRunner {
  run(
    command: VoiceCommand,
    emit: (event: VoiceEvent) => void,
  ): void | Promise<void>;
  beforeStateCommit?(previous: VoiceState, next: VoiceState): void;
  dispose?(): void;
}

export class VoiceToTextController {
  private readonly dispatcher: TransactionalDispatcher<
    VoiceState,
    VoiceEvent,
    VoiceCommand
  >;
  private disposed = false;

  constructor(
    private readonly options: {
      idSource: IdSource;
      runner: VoiceCommandRunner;
      observer?: TransitionObserver<VoiceState, VoiceEvent, VoiceCommand>;
      reportError?(error: DispatcherError<VoiceCommand>): void;
    },
  ) {
    this.dispatcher = new TransactionalDispatcher({
      initialState: { type: "idle" },
      transition,
      runCommand: (command, emit) => options.runner.run(command, emit),
      scheduler: {
        schedule(batch, execute) {
          for (const command of batch.commands) void execute(command);
        },
      },
      beforeCommit: (previous, next) =>
        options.runner.beforeStateCommit?.(previous, next),
      observer: options.observer,
      reportError: options.reportError,
    });
  }

  getSnapshot = (): VoiceState => this.dispatcher.getSnapshot();
  subscribe = (listener: () => void) => this.dispatcher.subscribe(listener);
  toggle = () => {
    this.dispatcher.send({
      type: "TOGGLE",
      attempt: this.options.idSource.next("voice-attempt"),
    });
  };

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const state = this.dispatcher.getSnapshot();
    this.dispatcher.dispose();
    if (state.type !== "idle") {
      this.dispatcher.startFinalizers([
        { type: "CancelDurationLimit", attempt: state.attempt },
        { type: "StopRecorder", attempt: state.attempt, reason: null },
        { type: "ReleaseMedia", attempt: state.attempt },
      ]);
    }
    this.options.runner.dispose?.();
  }
}

export const isVoiceRecording = (state: VoiceState) =>
  state.type === "recording" || state.type === "stopping";
export const isVoiceTranscribing = (state: VoiceState) =>
  state.type === "transcribing";
