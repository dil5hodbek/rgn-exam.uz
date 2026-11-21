import "./entry.css";

// The logo intro plays once per browser session. This runs before the page
// paints, so a returning visitor never sees a flash of the intro.
const introGate = `try{if(sessionStorage.getItem("rgn-auth-intro"))document.documentElement.setAttribute("data-auth-intro","skip")}catch(e){}`;

export default function EntryLayout({ children }: { children: React.ReactNode }) {
  return <>
    <script dangerouslySetInnerHTML={{ __html: introGate }} />
    {children}
  </>;
}
