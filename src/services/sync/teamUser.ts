const key = "device_user_name";

export function getDeviceUserName() {
  return localStorage.getItem(key) || "";
}

export function setDeviceUserName(name: string) {
  localStorage.setItem(key, name.trim());
}

export function ensureDeviceUserName() {
  let name = getDeviceUserName();
  if (!name) {
    name = window.prompt("What is your name?")?.trim() || "Me";
    setDeviceUserName(name);
  }
  return name;
}
