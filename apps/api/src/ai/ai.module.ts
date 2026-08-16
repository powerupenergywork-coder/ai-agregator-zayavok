import { Module } from "@nestjs/common";
import { env } from "../config/env";
import { AI_PROVIDER } from "./ai.types";
import { MockAiProvider } from "./mock-ai.provider";
import { OpenAiProvider } from "./openai-ai.provider";
import { MediaUnderstandingService } from "./media-understanding.service";

@Module({
  providers: [
    {
      provide: AI_PROVIDER,
      useClass: env.aiProvider === "openai" ? OpenAiProvider : MockAiProvider,
    },
    // Не за AI_PROVIDER: распознавание медиа не зависит от того, какой
    // провайдер выбран для классификации, и включается одним лишь наличием
    // ключа OpenAI. Свой mock-двойник ему не нужен — без ключа он просто
    // выключен и отвечает null.
    MediaUnderstandingService,
  ],
  exports: [AI_PROVIDER, MediaUnderstandingService],
})
export class AiModule {}
