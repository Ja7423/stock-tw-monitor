import { handleUpdate } from "./bot";
import { runReport } from "./job";
import type { TelegramUpdate } from "./telegram";
import type { Env } from "./types";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/telegram/webhook") {
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      const update = await request.json<TelegramUpdate>();
      // 先回 200 給 Telegram，避免處理時間過長被重送
      ctx.waitUntil(handleUpdate(env, update).catch((err) => console.error("handleUpdate failed", err)));
      return new Response("ok");
    }

    if (url.pathname === "/health") return new Response("ok");
    return new Response("not found", { status: 404 });
  },

  async scheduled(controller, env) {
    await runReport(env, new Date(controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
