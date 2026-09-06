import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { cn } from "~/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  accent?: "primary" | "success" | "warning" | "accent" | "brand1" | "brand2" | "brand3" | "brand4";
}

const ACCENT: Record<string, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  accent: "bg-accent/15 text-accent",
  // Dải sắc thái đỏ, dùng khi cần phân biệt nhiều thẻ cùng tông thương hiệu
  brand1: "bg-brand-1/10 text-brand-1",
  brand2: "bg-brand-2/10 text-brand-2",
  brand3: "bg-brand-3/10 text-brand-3",
  brand4: "bg-brand-4/10 text-brand-4",
};

export function StatCard({ label, value, icon: Icon, accent = "primary" }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", ACCENT[accent])}>
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
