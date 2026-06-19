# Modelo de Base de Datos

Este documento contiene el diagrama Entidad-Relación (ER) para el sistema de pedidos y productos.

## Diagrama ER (Horizontal)

```mermaid
erDiagram
  direction LR
  CATEGORIAS ||--o{ PRODUCTOS : contiene
  CLIENTES ||--o{ PEDIDOS : realiza
  PEDIDOS ||--|{ PARTIDAS : incluye
  PRODUCTOS ||--o{ PARTIDAS : se_vende_en
  CATEGORIAS {
    int id PK
    string nombre
    float descuento_pct
  }
  PRODUCTOS {
    int id PK
    string nombre
    int categoria_id FK
    string color
    string material
    string proveedor
    string descripcion
    float precio_base
    file fotos
    int existencias
    bool visible_en_sitio
    float descuento_pct
  }
  CLIENTES {
    int id PK
    string nombre
    string telefono
  }
  PEDIDOS {
    string folio PK
    int cliente_id FK
    date fecha_pedido
    date fecha_entrega
    string estatus
    float total
    float anticipo
    float resta
  }
  PARTIDAS {
    int id PK
    string folio_pedido FK
    int producto_id FK
    int cantidad
    string modificaciones
    float precio_unitario
    float importe
  }
```

## Notas de Implementacióna
* La tabla `PARTIDAS` funciona como la tabla intermedia (muchos a muchos) entre `PEDIDOS` y `PRODUCTOS`

