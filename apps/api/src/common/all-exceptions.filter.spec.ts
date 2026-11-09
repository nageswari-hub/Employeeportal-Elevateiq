import { HttpException } from '@nestjs/common';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';

function run(err: any) {
  const res: any = { headersSent: false, status: jest.fn().mockReturnThis(), json: jest.fn() };
  const host: any = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ method: 'GET', url: '/x' }) }) };
  new AllExceptionsFilter().catch(err, host);
  return { status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
}

describe('AllExceptionsFilter', () => {
  it('keeps HttpExceptions unchanged', () => {
    expect(run(new HttpException('nope', 403)).status).toBe(403);
  });
  it('maps Prisma unique violation to 409', () => {
    expect(run({ code: 'P2002', message: 'dup' }).status).toBe(409);
  });
  it('maps missing record to 404 and bad foreign key to 400', () => {
    expect(run({ code: 'P2025' }).status).toBe(404);
    expect(run({ code: 'P2003' }).status).toBe(400);
  });
  it('hides internals on real server errors but gives a reference', () => {
    const { status, body } = run(new Error('secret stack detail'));
    expect(status).toBe(500);
    expect(body.message).toMatch(/ref [a-z0-9]+/);
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});
