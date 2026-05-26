export function isIosSafariLike() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && /safari/i.test(navigator.userAgent);
}

export function notificationSupportMessage() {
  if (!("Notification" in window)) {
    return "Notifications are limited on this browser. The app still works, but reminders may need to be checked manually.";
  }
  if (isIosSafariLike()) {
    return "iPhone notifications depend on Safari/PWA support. Add the app to Home Screen and allow notifications if your iOS version supports them.";
  }
  return "";
}
