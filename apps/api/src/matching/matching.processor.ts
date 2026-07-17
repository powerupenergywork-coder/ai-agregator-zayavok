import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { MatchingService } from "./matching.service";
import { OrdersService } from "../orders/orders.service";

@Processor("matching")
export class MatchingProcessor extends WorkerHost {
  private readonly logger = new Logger(MatchingProcessor.name);

  constructor(
    private readonly matching: MatchingService,
    private readonly orders: OrdersService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    try {
      if (job.name === "start") {
        await this.matching.startDispatch(job.data.orderId);
      } else if (job.name === "checkin") {
        await this.orders.sendCompletionCheckin(job.data.orderId);
      } else if (job.name === "checkin-escalate") {
        await this.orders.escalateStaleOrder(job.data.orderId);
      }
    } catch (err) {
      this.logger.error(`Job ${job.name} failed for order ${job.data.orderId}: ${(err as Error).message}`);
      throw err;
    }
  }
}
