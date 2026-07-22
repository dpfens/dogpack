import { Injectable, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    dataLayer?: any[];
  }
}

/**
 * Represents a Google Analytics event with standard GA4 parameters.
 * 
 * @public
 * @interface GtagEvent
 * 
 * @example
 * ```typescript
 * const event: GtagEvent = {
 *   action: 'click',
 *   category: 'button',
 *   label: 'signup-button',
 *   value: 1
 * };
 * ```
 */
export interface GtagEvent {
  /** The action being tracked (e.g., 'click', 'submit', 'download') */
  action: string;
  /** The category of the event (e.g., 'button', 'form', 'video') */
  category: string;
  /** Optional label providing additional context for the event */
  label?: string;
  /** Optional numeric value associated with the event */
  value?: number;
}

/**
 * Custom dimensions and metrics for enhanced analytics tracking.
 * Allows passing additional key-value pairs to Google Analytics events.
 * 
 * @public
 * @interface CustomDimensions
 * 
 * @example
 * ```typescript
 * const dimensions: CustomDimensions = {
 *   user_tier: 'premium',
 *   experiment_variant: 'B',
 *   page_category: 'product'
 * };
 * ```
 */
export interface CustomDimensions {
  [key: string]: string | number | boolean;
}

/**
 * Configuration options for initializing Google Analytics.
 * 
 * @public
 * @interface GoogleAnalyticsConfig
 * 
 * @example
 * ```typescript
 * const config: GoogleAnalyticsConfig = {
 *   measurementId: 'G-XXXXXXXXXX',
 *   enabled: true,
 *   debug: false
 * };
 * ```
 */
export interface GoogleAnalyticsConfig {
  /** Google Analytics 4 measurement ID (format: G-XXXXXXXXXX) */
  measurementId: string;
  /** Whether analytics tracking is enabled. Set to false in development/testing. @defaultValue true */
  enabled?: boolean;
  /** Enable debug mode to log analytics calls to console without sending data. @defaultValue false */
  debug?: boolean;

  link_attribution?: boolean;  // Track multiple links to same destination
}

/**
 * Service for integrating Google Analytics 4 (GA4) into Angular applications.
 * 
 * Provides a type-safe, robust implementation for tracking page views, events,
 * conversions, and user interactions. Includes support for:
 * - Automatic page view tracking on route changes
 * - Custom event tracking with dimensions
 * - Error and exception tracking
 * - E-commerce conversion tracking
 * - User identification and properties
 * - Privacy compliance (consent management)
 * - Development/testing modes (disabled tracking with debug logging)
 * 
 * @public
 * @class GoogleAnalyticsService
 * 
 * @example
 * Basic initialization in app.config.ts:
 * ```typescript
 * export const appConfig: ApplicationConfig = {
 *   providers: [
 *     provideAppInitializer(() => {
 *       const ga = inject(GoogleAnalyticsService);
 *       ga.initialize('G-XXXXXXXXXX');
 *     })
 *   ]
 * };
 * ```
 * 
 * @example
 * Advanced initialization with configuration:
 * ```typescript
 * ga.initialize({
 *   measurementId: 'G-XXXXXXXXXX',
 *   enabled: environment.production,
 *   debug: !environment.production
 * });
 * ```
 * 
 * @example
 * Tracking events in components:
 * ```typescript
 * export class MyComponent {
 *   private ga = inject(GoogleAnalyticsService);
 * 
 *   onButtonClick() {
 *     this.ga.trackEvent({
 *       action: 'click',
 *       category: 'button',
 *       label: 'signup-cta',
 *       value: 1
 *     });
 *   }
 * }
 * ```
 */
@Injectable({
  providedIn: 'root'
})
export class GoogleAnalyticsService {
  private router = inject(Router);
  private isInitialized = false;
  private measurementId = '';
  private enabled = true;
  private debug = false;

  /**
   * Initializes Google Analytics with the provided configuration.
   * 
   * This method should be called once during application initialization,
   * typically in app.config.ts using provideAppInitializer. Calling this
   * method multiple times will log a warning and be ignored.
   * 
   * When enabled, this method:
   * - Dynamically loads the gtag.js script
   * - Configures the GA4 measurement stream
   * - Sets up automatic page view tracking on route changes
   * 
   * @param config - Either a measurement ID string or a configuration object
   * 
   * @remarks
   * - Set `enabled: false` to disable tracking in development/test environments
   * - Enable `debug: true` to log all tracking calls to console
   * - The service is SSR-safe and will not execute in non-browser environments
   * 
   * @example
   * Simple initialization with measurement ID:
   * ```typescript
   * gaService.initialize('G-XXXXXXXXXX');
   * ```
   * 
   * @example
   * Configuration object with environment-based settings:
   * ```typescript
   * gaService.initialize({
   *   measurementId: environment.gaTrackingId,
   *   enabled: environment.production,
   *   debug: !environment.production
   * });
   * ```
   * 
   * @example
   * Disabled for testing:
   * ```typescript
   * gaService.initialize({
   *   measurementId: 'G-TEST-ID',
   *   enabled: false,
   *   debug: true
   * });
   * ```
   */
  initialize(config: string | GoogleAnalyticsConfig): void {
    if (this.isInitialized) {
      console.warn('Google Analytics already initialized');
      return;
    }

    // Support both string and config object
    if (typeof config === 'string') {
      this.measurementId = config;
      this.enabled = true;
      this.debug = false;
    } else {
      this.measurementId = config.measurementId;
      this.enabled = config.enabled ?? true;
      this.debug = config.debug ?? false;
    }

    if (this.enabled) {
      this.loadGtagScript(this.measurementId);
    }
    
    this.setupPageViewTracking();
    this.isInitialized = true;

    if (this.debug) {
      console.log('[GA] Initialized', { measurementId: this.measurementId, enabled: this.enabled });
    }
  }

  /**
   * Dynamically loads the Google Analytics gtag.js script.
   * 
   * This private method:
   * - Initializes the dataLayer array
   * - Creates the gtag function
   * - Configures GA4 with send_page_view disabled (handled manually)
   * - Injects the script tag into the document head
   * 
   * @private
   * @param measurementId - The GA4 measurement ID
   * 
   * @remarks
   * This method is SSR-safe and will not execute if window is undefined.
   * Page views are handled manually to ensure proper tracking with Angular routing.
   */
  private loadGtagScript(measurementId: string): void {
    if (typeof window === 'undefined') return;

    // Initialize dataLayer
    window.dataLayer = window.dataLayer || [];
    window.gtag = function() {
      window.dataLayer!.push(arguments);
    };
    
    window.gtag('js', new Date());
    window.gtag('config', measurementId, {
      send_page_view: false, // We'll handle page views manually
      link_attribution: true,
      debug_mode: this.debug 
    });

    // Load the script
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    document.head.appendChild(script);
  }

  /**
   * Sets up automatic page view tracking for Angular route changes.
   * 
   * Subscribes to Angular Router's NavigationEnd events and automatically
   * tracks page views with the new URL path. This ensures accurate page
   * tracking in single-page applications.
   * 
   * @private
   * 
   * @remarks
   * This method is called automatically during initialization.
   * Page views are tracked using the urlAfterRedirects to capture the final URL.
   */
  private setupPageViewTracking(): void {
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        this.trackPageView(event.urlAfterRedirects);
      });
  }

  /**
   * Tracks a page view event in Google Analytics.
   * 
   * @param path - The URL path being viewed (e.g., '/products', '/about')
   * @param title - Optional page title. Defaults to document.title
   * 
   * @remarks
   * - Automatically called on route changes when service is initialized
   * - Can be manually called for custom page view tracking scenarios
   * - In debug mode, logs the page view to console instead of sending
   * - Safe to call in SSR environments (will not execute)
   * 
   * @example
   * Manual page view tracking:
   * ```typescript
   * gaService.trackPageView('/custom-path', 'Custom Page Title');
   * ```
   * 
   * @example
   * Track virtual page view:
   * ```typescript
   * gaService.trackPageView('/modal/signup', 'Signup Modal');
   * ```
   */
  trackPageView(path: string, title?: string): void {
    if (!this.isInitialized || !this.enabled || typeof window === 'undefined' || !window.gtag) {
      if (this.debug) {
        console.log('[GA] Page View:', { path, title });
      }
      return;
    }

    window.gtag('event', 'page_view', {
      page_path: path,
      page_title: title || document.title,
      page_location: window.location.href
    });
  }

  /**
   * Tracks a custom event in Google Analytics.
   * 
   * @param event - The event object containing action, category, label, and value
   * @param customDimensions - Optional custom dimensions and metrics to attach
   * 
   * @remarks
   * - Use this for tracking user interactions, feature usage, and business metrics
   * - In debug mode, logs events to console instead of sending
   * - All custom dimensions are passed through to GA4 as event parameters
   * 
   * @example
   * Track a button click:
   * ```typescript
   * gaService.trackEvent({
   *   action: 'click',
   *   category: 'button',
   *   label: 'signup-cta',
   *   value: 1
   * });
   * ```
   * 
   * @example
   * Track event with custom dimensions:
   * ```typescript
   * gaService.trackEvent(
   *   {
   *     action: 'search',
   *     category: 'product',
   *     label: query
   *   },
   *   {
   *     search_term: query,
   *     results_count: results.length,
   *     user_type: 'premium'
   *   }
   * );
   * ```
   * 
   * @example
   * Track feature usage:
   * ```typescript
   * gaService.trackEvent({
   *   action: 'export',
   *   category: 'data',
   *   label: 'csv',
   *   value: rowCount
   * });
   * ```
   */
  trackEvent(event: GtagEvent, customDimensions?: CustomDimensions): void {
    if (!this.isInitialized || !this.enabled || typeof window === 'undefined' || !window.gtag) {
      if (this.debug) {
        console.log('[GA] Event:', event, customDimensions);
      }
      return;
    }

    const eventParams: any = {
      event_category: event.category,
      event_label: event.label,
      value: event.value,
      ...customDimensions
    };

    window.gtag('event', event.action, eventParams);
  }

  /**
   * Tracks user interactions such as clicks, taps, and form submissions.
   * 
   * This is a convenience method that wraps trackEvent with a predefined
   * category of 'interaction' for common UI interactions.
   * 
   * @param action - The interaction type (e.g., 'click', 'tap', 'submit')
   * @param label - Optional label identifying the specific element
   * @param value - Optional numeric value associated with the interaction
   * 
   * @example
   * Track a navigation link click:
   * ```typescript
   * gaService.trackInteraction('click', 'nav-products');
   * ```
   * 
   * @example
   * Track a form submission:
   * ```typescript
   * gaService.trackInteraction('submit', 'contact-form', 1);
   * ```
   * 
   * @example
   * Track a video play with duration:
   * ```typescript
   * gaService.trackInteraction('play', 'product-demo-video', videoDuration);
   * ```
   */
  trackInteraction(action: string, label?: string, value?: number): void {
    this.trackEvent({
      action,
      category: 'interaction',
      label,
      value
    });
  }

  /**
   * Tracks errors and exceptions in the application.
   * 
   * Use this to monitor application health and identify issues in production.
   * Integrates with error handling services and monitoring tools.
   * 
   * @param description - A description of the error that occurred
   * @param fatal - Whether the error is fatal (crashes the app). Defaults to false
   * 
   * @remarks
   * - Fatal errors indicate crashes or critical failures
   * - Non-fatal errors are warnings or recoverable errors
   * - Consider integrating with Angular ErrorHandler for automatic tracking
   * 
   * @example
   * Track a caught error:
   * ```typescript
   * try {
   *   await this.apiService.loadData();
   * } catch (error) {
   *   gaService.trackError(`API Error: ${error.message}`, false);
   * }
   * ```
   * 
   * @example
   * Track a fatal error:
   * ```typescript
   * gaService.trackError('Critical: Database connection failed', true);
   * ```
   * 
   * @example
   * Use in ErrorHandler:
   * ```typescript
   * export class GlobalErrorHandler implements ErrorHandler {
   *   private ga = inject(GoogleAnalyticsService);
   * 
   *   handleError(error: Error) {
   *     this.ga.trackError(error.message, true);
   *     console.error(error);
   *   }
   * }
   * ```
   */
  trackError(description: string, fatal: boolean = false): void {
    if (!this.isInitialized || !this.enabled || typeof window === 'undefined' || !window.gtag) {
      if (this.debug) {
        console.log('[GA] Error:', { description, fatal });
      }
      return;
    }

    window.gtag('event', 'exception', {
      description,
      fatal
    });
  }

  /**
   * Tracks e-commerce conversion events.
   * 
   * Use this to track completed purchases, subscriptions, or other
   * revenue-generating events. Essential for e-commerce analytics and ROI tracking.
   * 
   * @param transactionId - Unique identifier for the transaction
   * @param value - Monetary value of the transaction
   * @param currency - ISO 4217 currency code. Defaults to 'USD'
   * 
   * @remarks
   * - Transaction IDs should be unique to prevent duplicate reporting
   * - Value should be the total transaction amount
   * - For detailed e-commerce tracking, consider using GA4's enhanced e-commerce events
   * 
   * @example
   * Track a purchase:
   * ```typescript
   * gaService.trackConversion('order-12345', 99.99, 'USD');
   * ```
   * 
   * @example
   * Track a subscription:
   * ```typescript
   * gaService.trackConversion(
   *   `sub-${userId}-${Date.now()}`,
   *   29.99,
   *   'EUR'
   * );
   * ```
   * 
   * @example
   * Track with order details:
   * ```typescript
   * const order = await this.checkoutService.complete();
   * gaService.trackConversion(
   *   order.id,
   *   order.total,
   *   order.currency
   * );
   * ```
   */
  trackConversion(transactionId: string, value: number, currency: string = 'USD'): void {
    if (!this.isInitialized || !this.enabled || typeof window === 'undefined' || !window.gtag) {
      if (this.debug) {
        console.log('[GA] Conversion:', { transactionId, value, currency });
      }
      return;
    }

    window.gtag('event', 'purchase', {
      transaction_id: transactionId,
      value,
      currency
    });
  }

  /**
   * Sets custom user properties for analytics.
   * 
   * User properties persist across sessions and can be used for segmentation
   * and custom reporting in Google Analytics.
   * 
   * @param properties - Key-value pairs of user properties
   * 
   * @remarks
   * - Properties apply to all future events for this user
   * - Useful for segmentation: user tier, preferences, account type
   * - Limited to 25 user properties per project in GA4
   * - Property values should be consistent (don't use timestamps)
   * 
   * @example
   * Set user tier:
   * ```typescript
   * gaService.setUserProperties({
   *   user_tier: 'premium',
   *   account_age_days: 365
   * });
   * ```
   * 
   * @example
   * Set user preferences:
   * ```typescript
   * gaService.setUserProperties({
   *   theme: 'dark',
   *   language: 'en-US',
   *   notifications_enabled: true
   * });
   * ```
   * 
   * @example
   * Set after authentication:
   * ```typescript
   * this.authService.user$.subscribe(user => {
   *   if (user) {
   *     gaService.setUserProperties({
   *       account_type: user.accountType,
   *       signup_method: user.signupMethod
   *     });
   *   }
   * });
   * ```
   */
  setUserProperties(properties: CustomDimensions): void {
    if (!this.isInitialized || !this.enabled || typeof window === 'undefined' || !window.gtag) {
      if (this.debug) {
        console.log('[GA] User Properties:', properties);
      }
      return;
    }

    window.gtag('set', 'user_properties', properties);
  }

  /**
   * Sets the user ID for cross-device tracking.
   * 
   * Enables tracking the same user across multiple devices and sessions.
   * Critical for accurate user journey analysis in multi-device environments.
   * 
   * @param userId - Unique, persistent identifier for the user
   * 
   * @remarks
   * - User ID should be a persistent identifier (e.g., database ID, hashed email)
   * - Must not contain personally identifiable information (PII)
   * - Enables User-ID reports in Google Analytics
   * - Call this after user authentication
   * 
   * @security
   * Never use email addresses, names, or other PII as user IDs.
   * Use hashed or anonymized identifiers only.
   * 
   * @example
   * Set user ID after login:
   * ```typescript
   * this.authService.login(email, password).subscribe(user => {
   *   gaService.setUserId(user.id);
   * });
   * ```
   * 
   * @example
   * Clear user ID on logout:
   * ```typescript
   * this.authService.logout().subscribe(() => {
   *   gaService.setUserId('');
   * });
   * ```
   * 
   * @example
   * Use hashed identifier:
   * ```typescript
   * const hashedId = await this.hashUserId(user.email);
   * gaService.setUserId(hashedId);
   * ```
   */
  setUserId(userId: string): void {
    if (!this.isInitialized || !this.enabled || typeof window === 'undefined' || !window.gtag) {
      if (this.debug) {
        console.log('[GA] User ID:', userId);
      }
      return;
    }

    window.gtag('config', this.measurementId, {
      user_id: userId
    });
  }

  /**
   * Tracks timing and performance metrics.
   * 
   * Use this to measure and track performance of operations, API calls,
   * page loads, or any timed user experience metrics.
   * 
   * @param name - Name of the timing metric
   * @param value - Duration in milliseconds
   * @param category - Optional category for grouping related timings
   * @param label - Optional label for additional context
   * 
   * @remarks
   * - Value should be in milliseconds
   * - Use consistent naming for aggregation in reports
   * - Useful for tracking page load times, API response times, feature render times
   * 
   * @example
   * Track API response time:
   * ```typescript
   * const start = performance.now();
   * await this.apiService.getData();
   * const duration = performance.now() - start;
   * gaService.trackTiming('api_load', duration, 'api', 'user-data');
   * ```
   * 
   * @example
   * Track component initialization:
   * ```typescript
   * ngOnInit() {
   *   const start = performance.now();
   *   this.loadData();
   *   const duration = performance.now() - start;
   *   gaService.trackTiming('component_init', duration, 'performance', 'dashboard');
   * }
   * ```
   * 
   * @example
   * Track feature rendering:
   * ```typescript
   * const start = Date.now();
   * await this.renderChart();
   * const duration = Date.now() - start;
   * gaService.trackTiming('chart_render', duration, 'visualization', chartType);
   * ```
   */
  trackTiming(name: string, value: number, category?: string, label?: string): void {
    if (!this.isInitialized || !this.enabled || typeof window === 'undefined' || !window.gtag) {
      if (this.debug) {
        console.log('[GA] Timing:', { name, value, category, label });
      }
      return;
    }

    window.gtag('event', 'timing_complete', {
      name,
      value,
      event_category: category,
      event_label: label
    });
  }

  /**
   * Enables or disables analytics data collection.
   * 
   * Use this to implement privacy controls and comply with GDPR, CCPA,
   * and other privacy regulations. Updates the consent state for analytics.
   * 
   * @param enabled - Whether to enable analytics collection
   * 
   * @remarks
   * - Affects all future tracking calls
   * - Should be called based on user consent preferences
   * - Updates the analytics_storage consent state
   * - Can be called before or after initialization
   * 
   * @example
   * Enable analytics after consent:
   * ```typescript
   * this.cookieService.getConsent().subscribe(consent => {
   *   gaService.setAnalyticsCollectionEnabled(consent.analytics);
   * });
   * ```
   * 
   * @example
   * Disable on user opt-out:
   * ```typescript
   * onOptOut() {
   *   gaService.setAnalyticsCollectionEnabled(false);
   *   this.showConfirmation('Analytics disabled');
   * }
   * ```
   * 
   * @example
   * Update based on region:
   * ```typescript
   * const requiresConsent = this.gdprService.requiresConsent(userRegion);
   * if (!requiresConsent) {
   *   gaService.setAnalyticsCollectionEnabled(true);
   * }
   * ```
   */
  setAnalyticsCollectionEnabled(enabled: boolean): void {
    if (typeof window === 'undefined' || !window.gtag) {
      if (this.debug) {
        console.log('[GA] Analytics Collection:', enabled);
      }
      return;
    }

    window.gtag('consent', 'update', {
      analytics_storage: enabled ? 'granted' : 'denied'
    });
  }

  /**
   * Checks whether analytics tracking is currently enabled.
   * 
   * @returns True if analytics is enabled, false otherwise
   * 
   * @remarks
   * - Returns false if initialized with `enabled: false`
   * - Useful for conditional tracking logic
   * - Does not reflect consent state (use setAnalyticsCollectionEnabled for consent)
   * 
   * @example
   * Conditional tracking:
   * ```typescript
   * if (gaService.isEnabled()) {
   *   gaService.trackEvent({...});
   * }
   * ```
   * 
   * @example
   * Show analytics status in UI:
   * ```typescript
   * get analyticsStatus(): string {
   *   return this.ga.isEnabled() ? 'Active' : 'Disabled';
   * }
   * ```
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}