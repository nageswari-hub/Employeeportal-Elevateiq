import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';

/**
 * Turns database/validation crashes into clean 4xx responses instead of opaque 500s.
 * Real server bugs still return 500 but are logged with a short id the user can quote.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private log = new Logger('Exceptions');

  catch(err: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const req = host.switchToHttp().getRequest();
    if (res.headersSent) return;

    if (err instanceof HttpException) {
      const status = err.getStatus();
      const body = err.getResponse();
      return res.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
    }

    const code: string | undefined = err?.code;
    const name: string = err?.constructor?.name ?? '';
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Something went wrong on our side.';

    if (code === 'P2002') { status = 409; message = 'That value already exists.'; }
    else if (code === 'P2025') { status = 404; message = 'Record not found.'; }
    else if (code === 'P2003') { status = 400; message = 'Related record does not exist or is still in use.'; }
    else if (code === 'P2004' || code === 'P2010' || /check constraint/i.test(String(err?.message))) { status = 400; message = 'Value rejected by a database rule.'; }
    else if (name === 'PrismaClientValidationError') { status = 400; message = 'Invalid input.'; }

    if (status === 500) {
      const ref = Math.random().toString(36).slice(2, 8);
      this.log.error(`[${ref}] ${req?.method} ${req?.url}: ${err?.stack ?? err}`);
      message = `${message} (ref ${ref})`;
    }
    res.status(status).json({ statusCode: status, message, error: HttpStatus[status] ?? 'Error' });
  }
}
