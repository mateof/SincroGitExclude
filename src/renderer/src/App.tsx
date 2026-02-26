import { useTranslation } from 'react-i18next'
import { MainLayout } from './components/layout/MainLayout'

function App(): React.ReactElement {
  const { t } = useTranslation()

  return <MainLayout />
}

export default App
