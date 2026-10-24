export const isTouch = (): boolean => matchMedia('(hover: none), (pointer: coarse)').matches;
export const isIOS = (): boolean => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = (): boolean => matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && navigator.standalone === true);
