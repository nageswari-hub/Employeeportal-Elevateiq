import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  // Fail fast on weak/missing secrets (never boot insecure)
  const accessSecret = process.env.JWT_ACCESS_SECRET ?? '';
  if (accessSecret.length < 32 || /CHANGE_ME/i.test(accessSecret)) {
    throw new Error('JWT_ACCESS_SECRET must be set to a random 32+ char value (see .env.example)');
  }

  const app = await NestFactory.create(AppModule, { cors: false, bodyParser: false });
  // Behind Nginx: trust ONE proxy hop so req.ip is the real client (rate limits + audit are not spoofable).
  (app.getHttpAdapter().getInstance() as any).set('trust proxy', 1);

  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());

  const origins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean);
  const isProd = process.env.NODE_ENV === 'production';
  app.enableCors({ origin: origins, credentials: true });

  // CSRF: Origin check on mutating requests (works with SameSite=Lax cookies).
  app.use((req: any, res: any, next: any) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const origin = req.headers.origin as string | undefined;
      if (origin && !origins.includes(origin)) {
        return res.status(403).json({ message: 'Forbidden (origin)', error: 'Forbidden', statusCode: 403 });
      }
    }
    next();
  });

  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.enableShutdownHooks(); // finish in-flight requests + close DB on docker stop

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`TeamFlow API listening on :${port} (prod=${isProd})`);
}
bootstrap();
