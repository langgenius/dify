# server, 如 feeds_proxy_server
IMAGE := dify-api
cur_dateTime = $(shell date +'%m%d%H%M')


upload: 
	docker build -t hkccr.ccs.tencentyun.com/dify/${IMAGE}:test_${cur_dateTime} .
	docker push hkccr.ccs.tencentyun.com/dify/${IMAGE}:test_${cur_dateTime}
	docker rmi hkccr.ccs.tencentyun.com/dify/${IMAGE}:test_${cur_dateTime}

