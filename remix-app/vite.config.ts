import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    reactRouter(),
    tsconfigPaths(),
  ],
  optimizeDeps: {
    // Khai báo trước để vite không discover muộn rồi reload giữa lúc render
    // (gây "Cannot read properties of null (reading 'useContext')")
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "lucide-react",
      "sonner",
      "clsx",
      "tailwind-merge",
      "class-variance-authority",
      "@radix-ui/react-slot",
      "@radix-ui/react-avatar",
      "@radix-ui/react-label",
      "@radix-ui/react-progress",
      "@radix-ui/react-select",
      "@radix-ui/react-toast",
      "zod",
    ],
    // Chỉ dùng ở server (prisma.server.ts) — không được đưa vào bundle client
    exclude: ["@prisma/client", ".prisma/client"],
  },
});
