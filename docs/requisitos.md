# R1 · Confirmar un pase de stock

Como operador, quiero cambiar el titular de una cantidad de un lote para que el stock figure a nombre del nuevo titular y permanezca en el depósito actual.

| Caso | Entrada | Resultado esperado |
|---|---|---|
| Confirmación | L-0101, Acero Alfa → Metal Delta, 500 kg | Acero Alfa pasa de 800 a 300 kg. Metal Delta pasa de 100 a 600 kg. El total sigue en 900 kg en Depósito Norte. Se registra un pase. |
| Stock insuficiente | Desde el saldo inicial, 801 kg desde Acero Alfa | Se rechaza y se conservan los saldos. |
| Mismo titular | Acero Alfa en origen y destino | Se rechaza antes de registrar movimientos. |
| Reintento | Mismo identificador y mismos datos | Se devuelve el pase existente. |
| Error de escritura | Falla el registro del ingreso | Se revierte el pase completo. |

El formulario está en [public/index.html](../public/index.html), la validación en [src/stock.mjs](../src/stock.mjs), las reglas de persistencia en [migrations/0001_stock.sql](../migrations/0001_stock.sql) y las pruebas en [test/stock.test.mjs](../test/stock.test.mjs).

La ficha se escribió después de implementar el flujo. En el historial, los trabajos se registran como commits y el documento reúne la trazabilidad entre requisito, pantalla, persistencia y pruebas.
