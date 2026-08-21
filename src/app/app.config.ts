import {
  ApplicationConfig,
  inject,
  PLATFORM_ID,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { GoogleAnalyticsService } from './services/analytics/google-analytics.service';
import { provideClientHydration } from '@angular/platform-browser';
import { isPlatformBrowser } from '@angular/common';
import { WebGpuService } from './services/webgpu/webgpu-service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideAppInitializer(() => {
      const gaService = inject(GoogleAnalyticsService);
      gaService.initialize('G-LCPSJYMVQS');
    }),
    provideAppInitializer(() => {
      const platformId = inject(PLATFORM_ID);
      if (!isPlatformBrowser(platformId)) {
        return;
      }
      const service = inject(WebGpuService);
      service.initialize({ powerPreference: 'high-performance' });
    }),
    provideClientHydration(),
  ],
};
