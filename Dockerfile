docker run -d \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -p 8080:8080 \
  --name jenkins \
  jenkins/jenkins:lts
