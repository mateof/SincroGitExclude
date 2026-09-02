import { useTranslation } from 'react-i18next'
import { MainLayout } from './components/layout/MainLayout'
import { RemotePickerHost } from './components/common/RemotePickerHost'

function App(): React.ReactElement {
  const { t } = useTranslation()

  return (
    <>
      <MainLayout />
      <RemotePickerHost />
    </>
  )
}

export default App
