/**
 * App.jsx — Raíz de la aplicación: providers y rutas.
 *
 * Para agregar una página nueva:
 *   1. Crea el archivo en src/pages/
 *   2. Impórtalo aquí
 *   3. Agrega un <Route path="/tu-ruta" element={...} />
 *   4. Si es privada, envuélvela en <RutaProtegida>
 *   5. El sidebar (Layout.jsx) se actualiza con el enlace correspondiente
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import RutaProtegida from './components/RutaProtegida'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Productos from './pages/Productos'
import Notas from './pages/Notas'
import NotaDetalle from './pages/NotaDetalle'
import NotaFormulario from './pages/NotaFormulario'
import Categorias from './pages/Categorias'
import Proveedores from './pages/Proveedores'
import Usuarios from './pages/Usuarios'
import Historico from './pages/Historico'

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AuthProvider>
        <Routes>
          {/* Ruta pública */}
          <Route path="/login" element={<Login />} />

          {/* Rutas privadas */}
          <Route path="/" element={
            <RutaProtegida><Dashboard /></RutaProtegida>
          } />

          <Route path="/historico" element={
            <RutaProtegida><Historico /></RutaProtegida>
          } />

          <Route path="/productos" element={
            <RutaProtegida><Productos /></RutaProtegida>
          } />

          <Route path="/notas" element={
            <RutaProtegida><Notas /></RutaProtegida>
          } />

          {/* /notas/nueva ANTES de /notas/:folio — React Router v6 prioriza literales
              sobre params, pero se declara primero para dejar el intent claro. */}
          <Route path="/notas/nueva" element={
            <RutaProtegida><NotaFormulario /></RutaProtegida>
          } />

          <Route path="/notas/:folio" element={
            <RutaProtegida><NotaDetalle /></RutaProtegida>
          } />

          <Route path="/notas/:folio/editar" element={
            <RutaProtegida><NotaFormulario /></RutaProtegida>
          } />

          {/* Secciones de catálogo — actualmente placeholders */}
          <Route path="/categorias" element={
            <RutaProtegida><Categorias /></RutaProtegida>
          } />

          <Route path="/proveedores" element={
            <RutaProtegida><Proveedores /></RutaProtegida>
          } />

          {/* Solo accesible para superadmin — la página misma lo verifica */}
          <Route path="/usuarios" element={
            <RutaProtegida><Usuarios /></RutaProtegida>
          } />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
