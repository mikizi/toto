(function () {
  "use strict";

  const MIXPANEL_TOKEN = "df63806169d5f67a744f4f9aa669a04c";
  const MIXPANEL_SDK_URL = "https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js";
  const PRESENCE_CLIENT_ID_KEY = "wc26-presence-id";
  const APP_NAME = "world_cup_2026_toto";

  const isLocal =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.protocol === "file:";

  /**
   * @param {unknown} value
   * @returns {value is string | number | boolean | string[] | number[] | boolean[]}
   */
  function isTrackableValue(value) {
    if (value === null || value === undefined || value === "") {
      return false;
    }
    if (typeof value === "number") {
      return Number.isFinite(value);
    }
    if (["string", "boolean"].includes(typeof value)) {
      return true;
    }
    return Array.isArray(value) && value.every((item) => (
      typeof item === "number" ? Number.isFinite(item) : ["string", "boolean"].includes(typeof item)
    ));
  }

  /**
   * @param {Record<string, unknown>} props
   * @returns {Record<string, string | number | boolean | string[] | number[] | boolean[]>}
   */
  function cleanProperties(props) {
    return Object.fromEntries(
      Object.entries(props).filter(([, value]) => isTrackableValue(value))
    );
  }

  /** @returns {string} */
  function getPresenceClientId() {
    try {
      const existing = window.localStorage.getItem(PRESENCE_CLIENT_ID_KEY);
      if (existing) {
        return existing;
      }
      const id =
        window.crypto?.randomUUID?.() ||
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      window.localStorage.setItem(PRESENCE_CLIENT_ID_KEY, id);
      return id;
    } catch {
      return "";
    }
  }

  /** @returns {Record<string, unknown>} */
  function baseProperties() {
    const params = new URLSearchParams(window.location.search);
    let referrerHost = "";
    try {
      referrerHost = document.referrer ? new URL(document.referrer).hostname : "";
    } catch {
      referrerHost = "";
    }
    return {
      app_name: APP_NAME,
      page_path: window.location.pathname || "/",
      page_title: document.title,
      referrer_host: referrerHost,
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: navigator.language,
      is_local: isLocal,
      is_debug_mode: params.get("debug") === "1" || params.get("debug") === "true",
      presence_client_id: getPresenceClientId(),
    };
  }

  function installMixpanelSnippet() {
    if (window.mixpanel?.__SV || window.mixpanel?.__loaded) {
      return;
    }

    const mixpanel = window.mixpanel || [];
    window.mixpanel = mixpanel;
    mixpanel._i = [];
    mixpanel.init = function (token, config, name) {
      const target = name ? (mixpanel[name] = []) : mixpanel;
      const instanceName = name || "mixpanel";

      target.people = target.people || [];
      target.toString = function (stub) {
        let label = "mixpanel";
        if (instanceName !== "mixpanel") {
          label += `.${instanceName}`;
        }
        return stub ? label : `${label} (stub)`;
      };
      target.people.toString = function () {
        return `${target.toString(true)}.people (stub)`;
      };

      const methods = (
        "disable time_event track track_pageview track_links track_forms register register_once alias " +
        "track_with_groups add_group set_group remove_group unregister identify name_tag set_config reset opt_in_tracking opt_out_tracking " +
        "has_opted_in_tracking has_opted_out_tracking clear_opt_in_out_tracking start_batch_senders " +
        "start_session_recording stop_session_recording people.set people.set_once people.unset people.increment people.append people.union " +
        "people.track_charge people.clear_charges people.delete_user people.remove"
      ).split(" ");

      for (const method of methods) {
        const parts = method.split(".");
        const parent = parts.length === 2 ? target[parts[0]] : target;
        const methodName = parts.length === 2 ? parts[1] : parts[0];
        parent[methodName] = function () {
          parent.push([methodName, ...Array.from(arguments)]);
        };
      }

      const groupMethods = "set set_once union unset remove delete".split(" ");
      target.get_group = function () {
        const groupCall = ["get_group", ...Array.from(arguments)];
        const group = {};
        for (const groupMethod of groupMethods) {
          group[groupMethod] = function () {
            target.push([groupCall, [groupMethod, ...Array.from(arguments)]]);
          };
        }
        return group;
      };

      mixpanel._i.push([token, config || {}, instanceName]);
      return target;
    };
    mixpanel.__SV = 1.2;

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.async = true;
    script.src = MIXPANEL_SDK_URL;
    const firstScript = document.getElementsByTagName("script")[0];
    firstScript.parentNode.insertBefore(script, firstScript);
  }

  function init() {
    installMixpanelSnippet();

    window.mixpanel.init(MIXPANEL_TOKEN, {
      api_host: "https://api-eu.mixpanel.com",
      autocapture: true,
      batch_requests: !isLocal,
      debug: isLocal,
      record_sessions_percent: 100,
      track_pageview: false,
      persistence: "localStorage",
      verbose: isLocal,
    });

    if (typeof window.mixpanel.register === "function") {
      window.mixpanel.register(cleanProperties(baseProperties()));
    }
  }

  /**
   * @param {string} eventName
   * @param {Record<string, unknown>} [properties]
   */
  function track(eventName, properties = {}) {
    if (!window.mixpanel || typeof window.mixpanel.track !== "function") {
      return;
    }
    const payload = cleanProperties({
      ...baseProperties(),
      ...properties,
    });
    if (isLocal) {
      window.mixpanel.track(eventName, payload, { send_immediately: true }, (response) => {
        console.info("Mixpanel event accepted", eventName, response);
      });
      return;
    }
    window.mixpanel.track(eventName, payload);
  }

  /**
   * @param {string} pageType
   * @param {Record<string, unknown>} [properties]
   */
  function trackPage(pageType, properties = {}) {
    track(`${pageType}_viewed`, properties);
  }

  window.totoAnalytics = {
    init,
    track,
    trackPage,
  };

  init();
})();
