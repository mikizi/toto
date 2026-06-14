(function () {
  "use strict";

  const GA_MEASUREMENT_ID = "G-KPTMQ0C1KJ";

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () {
    window.dataLayer.push(arguments);
  };

  /**
   * @param {string} eventName
   * @param {string} [eventCategory]
   * @param {string} [eventLabel]
   * @param {Record<string, unknown>} [params]
   */
  function trackEvent(eventName, eventCategory = "", eventLabel = "", params = {}) {
    if (typeof window.gtag !== "function") {
      return;
    }
    window.gtag("event", eventName, {
      event_category: eventCategory,
      event_label: eventLabel,
      ...params,
    });
  }

  /**
   * Use this from an SPA router after a route change.
   *
   * @param {string} pagePath
   * @param {string} [pageTitle]
   */
  function trackPageView(pagePath, pageTitle = document.title) {
    if (typeof window.gtag !== "function") {
      return;
    }
    window.gtag("event", "page_view", {
      page_title: pageTitle,
      page_location: window.location.origin + pagePath,
      page_path: pagePath,
      send_to: GA_MEASUREMENT_ID,
    });
  }

  window.totoGa = {
    measurementId: GA_MEASUREMENT_ID,
    trackEvent,
    trackPageView,
  };
})();
