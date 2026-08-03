import type React from "react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CodeHighlight } from "./CodeHighlight";
import type { CustomTagState } from "./stateTypes";
import {
  DyadBadge,
  DyadCard,
  DyadCardContent,
  DyadCardHeader,
  DyadExpandIcon,
  DyadStateIndicator,
} from "./DyadCardPrimitives";

interface Props {
  children?: ReactNode;
  node?: {
    properties?: {
      state?: CustomTagState;
      query?: string;
      chats?: string;
      evidence?: string;
      outcome?: string;
    };
  };
}

export const DyadExploreChatHistory: React.FC<Props> = ({ children, node }) => {
  const { t } = useTranslation("chat");
  const state = node?.properties?.state as CustomTagState;
  const inProgress = state === "pending";
  const outcome = node?.properties?.outcome || "";
  const [expanded, setExpanded] = useState(
    inProgress || outcome !== "complete",
  );

  useEffect(() => {
    if (!inProgress && outcome === "complete") setExpanded(false);
  }, [inProgress, outcome]);

  const query = node?.properties?.query || "";
  const chats = node?.properties?.chats || "0";
  const evidence = node?.properties?.evidence || "0";
  return (
    <DyadCard
      state={state}
      accentColor="purple"
      onClick={() => setExpanded(!expanded)}
      isExpanded={expanded}
      data-testid="dyad-explore-chat-history"
    >
      <DyadCardHeader icon={<History size={15} />} accentColor="purple">
        <DyadBadge color="purple">
          {t("exploreChatHistoryTool.badge")}
        </DyadBadge>
        <span className="font-medium text-sm text-foreground truncate">
          {query ? `"${query}"` : t("exploreChatHistoryTool.title")}
        </span>
        {!inProgress && (
          <span className="text-xs text-muted-foreground shrink-0">
            ({t("exploreChatHistoryTool.summary", { chats, evidence })})
          </span>
        )}
        {inProgress && (
          <DyadStateIndicator
            state="pending"
            pendingLabel={t("exploreChatHistoryTool.exploring")}
          />
        )}
        {state === "aborted" && (
          <DyadStateIndicator
            state="aborted"
            abortedLabel={t("exploreChatHistoryTool.didNotFinish")}
          />
        )}
        {state === "error" && (
          <DyadStateIndicator
            state="error"
            errorLabel={t("exploreChatHistoryTool.failed")}
          />
        )}
        <div className="ml-auto">
          <DyadExpandIcon isExpanded={expanded} />
        </div>
      </DyadCardHeader>
      <DyadCardContent isExpanded={expanded}>
        <div className="text-xs" onClick={(event) => event.stopPropagation()}>
          <CodeHighlight className="language-markdown">
            {children}
          </CodeHighlight>
        </div>
      </DyadCardContent>
    </DyadCard>
  );
};
