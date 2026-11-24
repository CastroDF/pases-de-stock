# Pases de stock

Versión académica simplificada del flujo de pases de stock de OECE Logistics, una aplicación real. Esta implementación se hizo para el entregable de Metodologías de Desarrollo Web. El código es independiente y todos los datos son ficticios.

La aplicación registra el cambio de titular de un lote. Descuenta kilos al origen, los suma al destino y conserva el total físico en el mismo depósito.

[Demo pública](https://pases-de-stock-academico.super-unit-5dba.workers.dev/) · [Requisito y casos de aceptación](docs/requisitos.md)

## Ejecutar y probar

Requiere Node.js 22.13 o posterior. No hay dependencias que instalar.

```sh
npm test
npm run dev
```

Abrí [el panel local](http://127.0.0.1:4123). El servidor usa SQLite local y el mismo código de aplicación que el Worker. Cada navegador recibe una sesión independiente para operar sobre los saldos ficticios.

## Arquitectura

- Panel HTML, CSS y JavaScript. Consulta stock, confirma pases y muestra el historial.
- API JSON en Cloudflare Workers. Valida datos, separa sesiones y permite reintentar una confirmación sin duplicarla.
- Cloudflare D1. La migración crea los lotes de ejemplo y asegura que el egreso y el ingreso se registren juntos.
- Nager.Date. Informa el próximo día hábil de revisión según el calendario argentino. El pase funciona aunque la consulta al calendario falle.

`npm run build` genera en `dist/` los módulos del Worker y los tres archivos del panel como recursos embebidos. Para otro despliegue, aplicá `migrations/0001_stock.sql` en una D1 nueva, cargá los módulos con `site.mjs` como entrada y asigná la base al binding `DB`. La integración continua de GitHub ejecuta `npm test` en cada push y pull request. La publicación en Cloudflare es manual.
