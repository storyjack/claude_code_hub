import { createContext, useContext } from "react";
import { t as translate } from "./i18n";

export const AppContext = createContext({
  lang: "zh",
  terminalFontSize: 13,
  t: (key, ...args) => translate("zh", key, ...args),
});

export function useApp() {
  return useContext(AppContext);
}
