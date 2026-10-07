import { useState, useEffect } from 'react';
export function useClock() {
 const [now,setNow] = useState(Date.now);
 useEffect(() => {const id=setInterval(() => setNow(Date.now()),30000);return () => clearInterval(id);},[]);
 return now;
}
