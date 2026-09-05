import { Card, CardContent } from "~/components/ui/card";
import { Lock } from "lucide-react";

export function LockedContent({ title, message }: { title: string; message: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-muted-foreground mb-4">
          <Lock className="h-7 w-7" />
        </div>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">{message}</p>
      </CardContent>
    </Card>
  );
}
