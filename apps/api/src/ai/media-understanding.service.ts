import { Injectable, Logger } from "@nestjs/common";
import OpenAI, { toFile } from "openai";
import { Language } from "@ai-zayavki/shared";
import { env } from "../config/env";

/**
 * Голосовое, видео и фото — во что-то, что можно прочитать.
 *
 * Зачем вообще: 16 августа клиент снял мусор на видео — для оценки объёма это
 * ровно то, что нужно исполнителю, — и получил «понимаю только текст». Люди
 * тут говорят голосом чаще, чем печатают: набрать «Анет Баба 7, 5 этаж, 11
 * квартира» на телефоне долго, сказать — три секунды.
 *
 * Видео расшифровывается без ffmpeg: OpenAI принимает mp4 и сам достаёт
 * звуковую дорожку. Картинку из видео мы не смотрим — для этого нужен ffmpeg
 * в образе, и это отдельный разговор.
 *
 * Всё здесь необязательное: любая ошибка возвращает null, и разговор идёт
 * дальше обычным путём. Распознавание не должно ронять заявку.
 */
@Injectable()
export class MediaUnderstandingService {
  private readonly logger = new Logger(MediaUnderstandingService.name);
  private readonly client: OpenAI | null;

  constructor() {
    // Ключа нет (AI_PROVIDER=mock в разработке) — сервис молча выключен.
    this.client = env.openaiApiKey ? new OpenAI({ apiKey: env.openaiApiKey, timeout: MEDIA_TIMEOUT_MS }) : null;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  /**
   * Голосовое или звук из видео — в текст.
   *
   * `language` подсказкой, а не фильтром: на казахском модель работает
   * заметно хуже, чем на русском, и подсказка это немного выправляет. Если
   * человек ответит на другом языке, расшифровка всё равно получится.
   */
  async transcribe(buffer: Buffer, filename: string, lang: Language): Promise<string | null> {
    if (!this.client) return null;
    if (buffer.length > env.mediaMaxBytes) {
      this.logger.warn(`Файл ${filename} слишком большой для расшифровки: ${buffer.length} байт`);
      return null;
    }
    try {
      const res = await this.client.audio.transcriptions.create({
        file: await toFile(buffer, filename),
        model: env.openaiTranscribeModel,
        language: lang,
      });
      const text = (res.text ?? "").trim();
      if (!text) return null;
      return text;
    } catch (err) {
      this.logger.error(`Не удалось расшифровать ${filename}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Фото — в описание для заявки.
   *
   * Просим не «опиши картинку», а назвать то, от чего зависит цена: что за
   * мусор и сколько его. Исполнителю в заявке нужно именно это, а «на фото
   * видна комната с ремонтом» ему не говорит ничего.
   *
   * Объём просим в мешках и кузовах, а не в кубометрах: клиент всё равно
   * отвечает так же — поле volumeM3 мы для этого и перевели в текст.
   */
  async describeImage(buffer: Buffer, mimeType: string, lang: Language): Promise<string | null> {
    if (!this.client) return null;
    if (buffer.length > env.mediaMaxBytes) return null;
    const prompt =
      lang === "kk"
        ? "Бұл — қызметке тапсырыс беретін клиенттің фотосуреті. Орындаушыға не маңызды екенін жазыңыз: не көрінеді, қандай материал, шамамен көлемі (қаптар, бактар, газель шанағы), кіру қиын ба. 1-2 сөйлем, тізімсіз. Сурет тапсырысқа қатысы жоқ болса — «тапсырысқа қатысы жоқ» деп жазыңыз."
        : "Это фотография от клиента, который заказывает услугу. Опиши то, что важно исполнителю: что на фото, какой материал, примерный объём (мешки, баки, кузов газели), есть ли сложности с подъездом или выносом. 1–2 предложения, без списков. Если фото не относится к заказу — так и напиши: «не относится к заказу».";
    try {
      const completion = await this.client.chat.completions.create({
        model: env.openaiVisionModel,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${buffer.toString("base64")}` } },
            ],
          },
        ],
      });
      const text = (completion.choices[0]?.message?.content ?? "").trim();
      return text || null;
    } catch (err) {
      this.logger.error(`Не удалось описать фото: ${(err as Error).message}`);
      return null;
    }
  }
}

/** Расшифровка минутного голосового занимает несколько секунд — таймаут
 *  заметно больше, чем у текстовых вызовов (там 8 с). Вебхук Meta ждёт
 *  ответа около 20 с, поэтому выше не поднимаем. */
const MEDIA_TIMEOUT_MS = 15000;
