import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

/**
 * Optional email delivery. Completely disabled unless SMTP_HOST is set, so local/dev
 * installs keep working with in-app notifications only. Credentials live in env vars,
 * never in the database.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  private readonly transporter: nodemailer.Transporter | null = null;
  private readonly from = process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'teamflow@localhost';
  private readonly appUrl = (process.env.APP_URL ?? process.env.CORS_ORIGIN?.split(',')[0] ?? 'http://localhost:3000').replace(/\/$/, '');

  constructor() {
    const host = process.env.SMTP_HOST;
    if (!host) return;
    const port = Number(process.env.SMTP_PORT ?? 587);
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === 'true' || port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } : undefined,
    });
  }

  get enabled() {
    return Boolean(this.transporter);
  }

  async send(to: string, subject: string, body: string, link?: string) {
    if (!this.transporter) return;
    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject: `[TeamFlow] ${subject}`.slice(0, 200),
        text: [body, link ? `${this.appUrl}${link}` : ''].filter(Boolean).join('\n\n'),
      });
    } catch (e: any) {
      this.log.warn(`Email to ${to} failed: ${e?.message ?? e}`);
    }
  }
}
