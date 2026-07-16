/**
 * @lena/shared — el núcleo del dominio.
 *
 * Aquí vive la lógica que NO PUEDE DIVERGIR entre cliente y servidor
 * (RNF-M-7): la máquina de estados, la proyección y el cálculo de totales.
 *
 * Cliente y servidor importan estas funciones **tal cual**, sin adaptadores.
 * Si se implementaran dos veces, algún día divergirían — y el bug aparecería
 * en producción, en hora pico, sin forma de reproducirlo.
 *
 * Todo lo de aquí es PURO: sin E/S, sin Date.now(), sin aleatoriedad. Esa
 * restricción es lo que permite el property-based testing que sostiene
 * RNF-I-6 (cliente y servidor convergen al mismo estado).
 *
 * Ver Docs/5.-Casos de uso y diagramas de estado.md §4.
 */

export * from './hlc';
export * from './tipos';
export * from './maquina-estados';
export * from './proyector';
