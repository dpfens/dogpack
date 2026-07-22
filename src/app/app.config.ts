import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { GoogleAnalyticsService } from './services/analytics/google-analytics.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideAppInitializer(() => {
      const gaService = inject(GoogleAnalyticsService);
      gaService.initialize('G-J0ZMYBT112');
    }),
  ]
};