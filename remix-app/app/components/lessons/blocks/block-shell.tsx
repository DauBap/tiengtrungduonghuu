import { cn } from "~/lib/utils";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { CheckCircle2, Lock } from "lucide-react";
import { BLOCK_META, type LearningBlockType } from "~/lib/learning-blocks";
import type { ProgressStatus } from "~/types/progress";

interface BlockShellProps {
  type: LearningBlockType;
  title: string;
  description?: string | null;
  status: ProgressStatus;
  required?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/** Khung dùng chung cho mọi dạng block: header có icon + trạng thái, body, footer hành động */
export function BlockShell({ type, title, description, status, required = true, children, footer }: BlockShellProps) {
  const meta = BLOCK_META[type];
  const Icon = meta.icon;
  const isLocked = status === "LOCKED";
  const isDone = status === "COMPLETED";

  return (
    <Card className={cn(isLocked && "opacity-60", isDone && "border-success/30")}>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
              isDone ? "bg-success/15 text-success" : isLocked ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
            )}
          >
            {isLocked ? <Lock className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{title}</h3>
              <Badge variant="outline" className="bg-muted/50 text-muted-foreground text-[10px] font-medium">
                {meta.label}
              </Badge>
              {!required && (
                <Badge variant="outline" className="text-[10px] font-medium text-muted-foreground">
                  Tùy chọn
                </Badge>
              )}
              {isDone && (
                <Badge variant="outline" className="bg-success/15 text-success border-success/30 gap-1 text-[10px]">
                  <CheckCircle2 className="h-3 w-3" />
                  Hoàn thành
                </Badge>
              )}
            </div>
            {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {children}
        {footer}
      </CardContent>
    </Card>
  );
}
