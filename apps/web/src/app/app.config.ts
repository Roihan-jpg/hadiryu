import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { csrfInterceptor } from './core/security/csrf.interceptor';
import { provideAngularQuery } from '@tanstack/angular-query-experimental';
import { appQueryClient } from './core/query/query-client';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withInterceptors([csrfInterceptor])),
    provideRouter(routes),
    provideAngularQuery(appQueryClient),
  ],
};
