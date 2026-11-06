import {createRoot} from 'react-dom/client';
import AppView from './AppView';
import {useAppController} from './useAppController';
import './style.css';
import './typography.css';

function App(){
 const controller=useAppController();
 return <AppView {...controller}/>;
}
createRoot(document.getElementById('root')!).render(<App/>);
