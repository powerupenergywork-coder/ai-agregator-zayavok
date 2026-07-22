import { Module } from "@nestjs/common";
import { ProspectService } from "./prospect.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { MatchingModule } from "../matching/matching.module";
import { AuditLogService } from "../common/audit-log.service";

@Module({
  imports: [NotificationsModule, MatchingModule],
  providers: [ProspectService, AuditLogService],
  exports: [ProspectService],
})
export class ProspectModule {}
