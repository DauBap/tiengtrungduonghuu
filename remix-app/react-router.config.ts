import type { Config } from "@react-router/dev/config";
import { vercelPreset } from "@vercel/react-router/vite";

export default {
  ssr: true,
  // Preset của Vercel: sinh Vercel Functions cho route SSR và cho phép cấu hình
  // memory/maxDuration theo từng route. Thiếu nó, bản deploy chỉ có static assets.
  presets: [vercelPreset()],
  future: {
    v8_middleware: true,
    v8_splitRouteModules: true,
    v8_viteEnvironmentApi: true,
    v8_passThroughRequests: true,
    v8_trailingSlashAwareDataRequests: true,
  },
} satisfies Config;
