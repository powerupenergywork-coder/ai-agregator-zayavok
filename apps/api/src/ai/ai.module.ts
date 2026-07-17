import { Module } from "@nestjs/common";
import { env } from "../config/env";
import { AI_PROVIDER } from "./ai.types";
import { MockAiProvider } from "./mock-ai.provider";
import { OpenAiProvider } from "./openai-ai.provider";

@Module({
  providers: [
    {
      provide: AI_PROVIDER,
      useClass: env.aiProvider === "openai" ? OpenAiProvider : MockAiProvider,
    },
  ],
  exports: [AI_PROVIDER],
})
export class AiModule {}
