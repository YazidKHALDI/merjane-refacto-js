import fastifyPlugin from 'fastify-plugin';
import {serializerCompiler, validatorCompiler, type ZodTypeProvider} from 'fastify-type-provider-zod';
import {z} from 'zod';

export const orderController = fastifyPlugin(async server => {
	// Add schema validator and serializer
	server.setValidatorCompiler(validatorCompiler);
	server.setSerializerCompiler(serializerCompiler);

	server.withTypeProvider<ZodTypeProvider>().post('/orders/:orderId/processOrder', {
		schema: {
			params: z.object({
				orderId: z.coerce.number(),
			}),
			response: {
				200: z.object({
					orderId: z.number(),
				}),
			},
		},
	}, async (request, reply) => {
		const orderService = server.diContainer.resolve('orderService');
		const order = await orderService.processOrder(request.params.orderId);
		await reply.send({orderId: order.id});
	});
});

