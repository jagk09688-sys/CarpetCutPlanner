function Welcome(props){
    return <h1>Hello, {props.name}</h1>;
}
// src/App.jsx
import Greeting from './components/Greeting';
function App(){
    return (
        <div>
            <Greeting name = "Jagjeet Kaur"/>
        </div>
    );
}