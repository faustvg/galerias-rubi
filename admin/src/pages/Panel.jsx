/**
 * Panel.jsx — Página de inicio del panel admin.
 *
 * Punto de entrada después del login. Muestra accesos rápidos a las
 * secciones principales. En etapas futuras aquí irán métricas y resúmenes.
 */

import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Layout from '../components/Layout'

const COLORES_ROL = {
  superadmin: 'bg-purple-100 text-purple-700',
  admin:      'bg-blue-100 text-blue-700',
  viewer:     'bg-gray-100 text-gray-500',
  worker:     'bg-green-100 text-green-700',
}

const ACCESOS = [
  {
    to:          '/notas',
    titulo:      'Notas / Ventas',
    descripcion: 'Crear y gestionar pedidos de clientes',
  },
  {
    to:          '/productos',
    titulo:      'Catálogo de productos',
    descripcion: 'Ver, crear y editar productos',
  },
  {
    to:          '/categorias',
    titulo:      'Categorías',
    descripcion: 'Organizar el catálogo por tipo',
  },
  {
    to:          '/proveedores',
    titulo:      'Proveedores',
    descripcion: 'Empresas y personas que surten materiales',
  },
]

export default function Panel() {
  const { usuario } = useAuth()
  const colorRol = COLORES_ROL[usuario?.rol] ?? 'bg-gray-100 text-gray-500'

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">
          Bienvenido, {usuario?.nombre}
        </h1>
        <div className="flex items-center gap-2 mt-1">
          <p className="text-sm text-gray-500">Acceso:</p>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colorRol}`}>
            {usuario?.rol}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {ACCESOS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="bg-white border border-gray-200 hover:border-amber-300
                       rounded-2xl p-5 group transition-colors"
          >
            <h2 className="font-semibold text-gray-800 group-hover:text-amber-700 mb-0.5">
              {item.titulo}
            </h2>
            <p className="text-sm text-gray-400">{item.descripcion}</p>
          </Link>
        ))}
      </div>
    </Layout>
  )
}
