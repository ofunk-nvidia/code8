import { ngcBaseUrl } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { OpenAICompatibleProvider } from "./OpenAICompatible"

interface NvidiaNimProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const NvidiaNimProvider = ({ showModelOptions, isPopup, currentMode }: NvidiaNimProviderProps) => (
	<OpenAICompatibleProvider
		currentMode={currentMode}
		defaultBaseUrl={ngcBaseUrl}
		hideAzureOptions={true}
		isPopup={isPopup}
		lockBaseUrl={true}
		providerName="NVIDIA NGC / NIM"
		showModelOptions={showModelOptions}
	/>
)
