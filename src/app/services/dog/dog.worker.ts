/// <reference lib="webworker" />
import { DogRunRequest } from "../../models/dog";
import { handleWorkerMessages } from "../../utilities/worker";
import { ChannelImage } from "dogpack";
import { executeDogProcessingContext } from '../../utilities/dog'

handleWorkerMessages<DogRunRequest, ChannelImage>(async ({ layer, image }: DogRunRequest) => {
  console.log(layer, image);
  return await executeDogProcessingContext({dog: [layer]}, image);
});