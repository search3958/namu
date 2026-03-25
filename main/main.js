// Google Analytics (gtag.js)
const gaId = 'G-7N56NHPY3C';
const gaScript = document.createElement('script');
gaScript.async = true;
gaScript.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
document.head.appendChild(gaScript);

window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', gaId);

// Google AdSense Global
const adClient = 'ca-pub-6151036058675874';
const adGlobalScript = document.createElement('script');
adGlobalScript.async = true;
adGlobalScript.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adClient}`;
adGlobalScript.crossOrigin = 'anonymous';
document.head.appendChild(adGlobalScript);

// AdSense Auto-Relaxed Ad (Bottom of Body)
window.addEventListener('DOMContentLoaded', () => {
    const adIns = document.createElement('ins');
    adIns.className = 'adsbygoogle';
    adIns.style.display = 'block';
    adIns.dataset.adFormat = 'autorelaxed';
    adIns.dataset.adClient = adClient;
    adIns.dataset.adSlot = '2183688121';
    document.body.appendChild(adIns);

    const adPushScript = document.createElement('script');
    adPushScript.textContent = '(adsbygoogle = window.adsbygoogle || []).push({});';
    document.body.appendChild(adPushScript);
});
